-- Ocean Spray Grower Database Schema
-- This schema stores farm, contract, bed block, and bed data fetched from the Ocean Spray API
--
-- PREREQUISITES: The "growers" database must exist before running this script
-- If you haven't created it yet, run setup_database.sql first
--
-- Usage:
--   psql -d growers -f schema.sql
--   (or use full path to psql if not in PATH)

-- Enable PostGIS extension for geometry support (optional, if you want to use native geometry types)
-- CREATE EXTENSION IF NOT EXISTS postgis;

-- Farms table (grower organizations)
CREATE TABLE IF NOT EXISTS farms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    name2 VARCHAR(255),
    voting_contact VARCHAR(255),
    email VARCHAR(255),
    phone_number VARCHAR(50),

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Farm addresses table (multiple addresses can belong to one farm)
CREATE TABLE IF NOT EXISTS farm_addresses (
    id SERIAL PRIMARY KEY,
    farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    street VARCHAR(255),
    street2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(100),

    -- Geographic coordinates for mapping
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Unique constraint on address per farm
    UNIQUE (farm_id, street, city, state, postal_code)
);

-- Contracts table
CREATE TABLE IF NOT EXISTS contracts (
    id SERIAL PRIMARY KEY,
    api_contract_id INTEGER NOT NULL,
    contract_number VARCHAR(20) NOT NULL,
    farm_id INTEGER REFERENCES farms(id) ON DELETE CASCADE,
    crop_year INTEGER,

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Unique constraint on API contract ID and crop year
    UNIQUE (api_contract_id, crop_year)
);

-- Bed blocks table (groupings of beds, formerly "bogs")
CREATE TABLE IF NOT EXISTS bed_blocks (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    name VARCHAR(100),

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Unique constraint on block name per contract
    UNIQUE (contract_id, name)
);

-- Beds table (individual cranberry beds/plots)
CREATE TABLE IF NOT EXISTS beds (
    id SERIAL PRIMARY KEY,
    api_bed_history_id INTEGER NOT NULL,
    contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    bed_block_id INTEGER REFERENCES bed_blocks(id) ON DELETE SET NULL,
    farm_address_id INTEGER REFERENCES farm_addresses(id) ON DELETE SET NULL,
    bed_name VARCHAR(100),
    handler_section_name VARCHAR(50),
    acres DECIMAL(10, 2),
    variety VARCHAR(100),
    plant_date TIMESTAMP,

    -- Fruit type flags
    fruit_type_export BOOLEAN DEFAULT FALSE,
    fruit_type_global_gap BOOLEAN DEFAULT FALSE,
    fruit_type_organic BOOLEAN DEFAULT FALSE,
    fruit_type_processed BOOLEAN DEFAULT FALSE,
    fruit_type_white BOOLEAN DEFAULT FALSE,

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Unique constraint on API bed history ID
    UNIQUE (api_bed_history_id)
);

-- Shapes table (polygon geometry for beds)
CREATE TABLE IF NOT EXISTS shapes (
    id SERIAL PRIMARY KEY,
    bed_id INTEGER NOT NULL REFERENCES beds(id) ON DELETE CASCADE,
    shape_type VARCHAR(50),
    shape_value TEXT,

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_farms_name ON farms(name);

CREATE INDEX IF NOT EXISTS idx_farm_addresses_farm_id ON farm_addresses(farm_id);
CREATE INDEX IF NOT EXISTS idx_farm_addresses_city ON farm_addresses(city);
CREATE INDEX IF NOT EXISTS idx_farm_addresses_state ON farm_addresses(state);
CREATE INDEX IF NOT EXISTS idx_farm_addresses_coordinates ON farm_addresses(latitude, longitude);

CREATE INDEX IF NOT EXISTS idx_contracts_api_contract_id ON contracts(api_contract_id);
CREATE INDEX IF NOT EXISTS idx_contracts_contract_number ON contracts(contract_number);
CREATE INDEX IF NOT EXISTS idx_contracts_farm_id ON contracts(farm_id);
CREATE INDEX IF NOT EXISTS idx_contracts_crop_year ON contracts(crop_year);

CREATE INDEX IF NOT EXISTS idx_bed_blocks_contract_id ON bed_blocks(contract_id);
CREATE INDEX IF NOT EXISTS idx_bed_blocks_name ON bed_blocks(name);

CREATE INDEX IF NOT EXISTS idx_beds_api_bed_history_id ON beds(api_bed_history_id);
CREATE INDEX IF NOT EXISTS idx_beds_contract_id ON beds(contract_id);
CREATE INDEX IF NOT EXISTS idx_beds_bed_block_id ON beds(bed_block_id);
CREATE INDEX IF NOT EXISTS idx_beds_farm_address_id ON beds(farm_address_id);
CREATE INDEX IF NOT EXISTS idx_beds_variety ON beds(variety);

CREATE INDEX IF NOT EXISTS idx_shapes_bed_id ON shapes(bed_id);

-- Trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_farms_updated_at BEFORE UPDATE ON farms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_farm_addresses_updated_at BEFORE UPDATE ON farm_addresses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contracts_updated_at BEFORE UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bed_blocks_updated_at BEFORE UPDATE ON bed_blocks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_beds_updated_at BEFORE UPDATE ON beds
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- View for beds with complete farm and contract information
CREATE OR REPLACE VIEW beds_complete AS
SELECT
    b.*,
    c.contract_number,
    c.crop_year,
    bb.name as bed_block_name,
    fa.street as address_street,
    fa.street2 as address_street2,
    fa.city as address_city,
    fa.state as address_state,
    fa.postal_code as address_postal_code,
    fa.country as address_country,
    f.id as farm_id,
    f.name as farm_name,
    f.name2 as farm_name2,
    f.voting_contact as farm_voting_contact,
    f.email as farm_email,
    f.phone_number as farm_phone_number
FROM beds b
JOIN contracts c ON b.contract_id = c.id
LEFT JOIN bed_blocks bb ON b.bed_block_id = bb.id
LEFT JOIN farm_addresses fa ON b.farm_address_id = fa.id
LEFT JOIN farms f ON c.farm_id = f.id;

-- View for beds with shapes
CREATE OR REPLACE VIEW beds_with_shapes AS
SELECT
    b.*,
    c.contract_number,
    c.crop_year,
    bb.name as bed_block_name,
    f.id as farm_id,
    f.name as farm_name,
    json_agg(
        json_build_object(
            'shape_id', s.id,
            'type', s.shape_type,
            'value', s.shape_value
        ) ORDER BY s.id
    ) FILTER (WHERE s.id IS NOT NULL) AS shapes
FROM beds b
JOIN contracts c ON b.contract_id = c.id
LEFT JOIN bed_blocks bb ON b.bed_block_id = bb.id
LEFT JOIN farms f ON c.farm_id = f.id
LEFT JOIN shapes s ON b.id = s.bed_id
GROUP BY b.id, c.contract_number, c.crop_year, bb.name, f.id, f.name;

-- Summary view for contracts
CREATE OR REPLACE VIEW contract_summary AS
SELECT
    c.id as contract_id,
    c.api_contract_id,
    c.contract_number,
    c.crop_year,
    f.id as farm_id,
    f.name as farm_name,
    COUNT(DISTINCT b.id) as total_beds,
    COUNT(DISTINCT bb.id) as total_bed_blocks,
    COUNT(DISTINCT b.bed_name) as unique_bed_names,
    SUM(b.acres) as total_acres,
    COUNT(DISTINCT b.variety) as variety_count,
    MIN(b.plant_date) as earliest_plant_date,
    MAX(b.plant_date) as latest_plant_date
FROM contracts c
LEFT JOIN farms f ON c.farm_id = f.id
LEFT JOIN beds b ON c.id = b.contract_id
LEFT JOIN bed_blocks bb ON b.bed_block_id = bb.id
GROUP BY c.id, c.api_contract_id, c.contract_number, c.crop_year, f.id, f.name
ORDER BY c.contract_number, c.crop_year;

-- Summary view for farms
CREATE OR REPLACE VIEW farm_summary AS
SELECT
    f.*,
    COUNT(DISTINCT c.id) as total_contracts,
    COUNT(DISTINCT b.id) as total_beds,
    COUNT(DISTINCT bb.id) as total_bed_blocks,
    SUM(b.acres) as total_acres,
    MIN(c.crop_year) as earliest_crop_year,
    MAX(c.crop_year) as latest_crop_year
FROM farms f
LEFT JOIN contracts c ON f.id = c.farm_id
LEFT JOIN beds b ON c.id = b.contract_id
LEFT JOIN bed_blocks bb ON b.bed_block_id = bb.id
GROUP BY f.id
ORDER BY f.name;

-- Summary view for bed blocks
CREATE OR REPLACE VIEW bed_block_summary AS
SELECT
    bb.id as bed_block_id,
    bb.name as bed_block_name,
    c.id as contract_id,
    c.contract_number,
    c.crop_year,
    COUNT(DISTINCT b.id) as total_beds,
    SUM(b.acres) as total_acres,
    COUNT(DISTINCT b.variety) as variety_count
FROM bed_blocks bb
JOIN contracts c ON bb.contract_id = c.id
LEFT JOIN beds b ON bb.id = b.bed_block_id
GROUP BY bb.id, bb.name, c.id, c.contract_number, c.crop_year
ORDER BY c.contract_number, bb.name;
