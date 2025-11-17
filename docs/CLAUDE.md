# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js utility for fetching grower contract data from the Ocean Spray Grower API. The application reads contract numbers from a text file, prompts for API credentials, and downloads contract JSON data to an output directory.

## Setup

1. **Configure environment variables**:
   ```bash
   cp .env .env.local  # Optional: keep local config separate
   # Edit .env and add your Ocean Spray API token and database credentials
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up the database** (automated):
   ```bash
   npm run sql
   ```

   This will:
   - Drop the `growers` database if it exists
   - Create a fresh `growers` database
   - Run `schema.sql` to create all tables, indexes, and views
   - Display confirmation of created tables

   **Manual setup (if needed):** If you prefer manual setup or the automated script doesn't work:
   ```bash
   # Step 1: Create the database
   psql -U postgres -f setup_database.sql

   # Step 2: Create tables and schema
   psql -d growers -f schema.sql
   ```

   **Troubleshooting on Mac:** If you get "command not found: psql", find psql location:
   ```bash
   find /Applications /usr/local /Library -name psql 2>/dev/null
   ```

   Common locations:
   - Postgres.app: `/Applications/Postgres.app/Contents/Versions/*/bin/psql`
   - Homebrew: `/usr/local/bin/psql` or `/opt/homebrew/bin/psql`
   - EnterpriseDB: `/Library/PostgreSQL/*/bin/psql`

## Available Commands

```bash
# Set up/reset database (drops and recreates database, runs schema)
npm run sql

# Fetch contract data from API and save to database
npm start

# Update farm names in database from GrowerList2024.json
npm run update-farms

# Generate summary report (displays in terminal and saves to output/summary.csv)
npm run summary
```

## Running the Application

**First time setup:**
```bash
npm run sql          # Set up database
npm start            # Fetch and import data
npm run update-farms # Update farm names from GrowerList2024.json
npm run summary      # Generate summary report
```

**Subsequent runs:**
```bash
npm start      # Fetch more data
npm run summary # Update summary report
```

The application will:
1. Test database connection (exits if connection fails)
2. Read API token from `.env` or prompt if not set
3. Ask for a crop year (defaults to current year)
4. Read contract numbers from `contracts.txt` (one per line)
5. For each contract:
   - Fetch JSON data from Ocean Spray API
   - Save JSON file to `./data/{cropYear}/{contractNumber}.json`
   - Insert/update data in PostgreSQL database (farms, farm_addresses, contracts, bed_blocks, beds, shapes tables)
6. Display comprehensive status report with both API and database statistics

## Project Structure

- **fetchContracts.js**: Main application entry point containing all logic
  - Uses ES module syntax (`type: "module"` in package.json)
  - Interactive CLI prompts using Node's `readline` module
  - Fetches from Ocean Spray API: `https://grower-gbs-prod.oceanspray.io/v1/bog/{contractNumber}`
  - Sequential processing of contracts (one at a time)

- **contracts.txt**: Input file with contract numbers (one per line)
- **data/**: Directory containing cropYear subfolders with fetched contract JSON files
  - Files are organized as `data/{cropYear}/{contractNumber}.json`
  - Re-fetching a contract for the same year will overwrite the existing file
- **output/**: Directory for generated reports
  - `summary.csv`: Contract summary report with farm names and total acres
- **.env**: Environment variables for API token and database credentials (not committed to git)
- **setupDatabase.js**: Automated database setup script (run via `npm run sql`)
- **updateFarmNames.js**: Updates farm names in database from GrowerList2024.json (run via `npm run update-farms`)
- **generateSummary.js**: Summary report generator (run via `npm run summary`)
- **setup_database.sql**: Manual database creation SQL (alternative to setupDatabase.js)
- **schema.sql**: PostgreSQL schema for storing farm, contract, bed block, and bed data
  - `farms` table: Grower/farm organizations (contact info placeholders)
  - `farm_addresses` table: Addresses linked to farms (multiple addresses per farm)
  - `contracts` table: Contract records linked to farms
  - `bed_blocks` table: Bed groupings (formerly "bogs" from API's BogName field)
  - `beds` table: Individual cranberry beds/plots linked to contracts and bed blocks
  - `shapes` table: Polygon geometry data for each bed
  - Includes helpful views: `beds_complete`, `beds_with_shapes`, `contract_summary`, `farm_summary`, `bed_block_summary`

## Architecture Notes

- Single-file application with no internal module structure
- Synchronous file I/O for reading contracts list
- Asynchronous HTTP requests using axios
- Sequential API calls (not parallelized) to avoid rate limiting
- PostgreSQL connection pool for database operations
- Transactional database inserts (all-or-nothing per contract)
- UPSERT operations (ON CONFLICT DO UPDATE) for all tables
- Separate error tracking for API vs database operations
- Continues processing even if database insert fails for a contract

## Database Schema

The PostgreSQL schema is fully normalized with the following structure:

**Relationships:**
- `farms` (1) → (many) `farm_addresses`
- `farms` (1) → (many) `contracts`
- `contracts` (1) → (many) `bed_blocks`
- `contracts` (1) → (many) `beds`
- `bed_blocks` (1) → (many) `beds`
- `farm_addresses` (1) → (many) `beds`
- `beds` (1) → (many) `shapes`

**Tables (all use `id` SERIAL as primary key):**
- **`farms`**: Farm organizations (name, voting_contact, email, phone_number - all nullable for now)
- **`farm_addresses`**: Addresses linked to farms via `farm_id` (one farm can have multiple addresses)
- **`contracts`**: Contracts with `api_contract_id` (from API), `contract_number`, `farm_id`, and `crop_year`
- **`bed_blocks`**: Bed groupings/blocks (name comes from API's "BogName" field)
- **`beds`**: Individual cranberry beds with `api_bed_history_id` (from API's "BedHistoryId"), linked to `contract_id`, `bed_block_id`, and `farm_address_id`
  - `bed_name` and `handler_section_name` both store API's "HandlerSectionName"
  - Contains variety, acres, plant_date, and fruit type flags
- **`shapes`**: Polygon geometry for beds (linked via `bed_id`)

**Views:**
- **`beds_complete`**: Beds with full farm, address, contract, and bed block details
- **`beds_with_shapes`**: Beds with shapes aggregated as JSON
- **`contract_summary`**: Aggregated statistics per contract (total beds, bed blocks, acres, varieties)
- **`farm_summary`**: Aggregated statistics per farm (total contracts, beds, bed blocks, acres)
- **`bed_block_summary`**: Statistics per bed block (total beds, acres, varieties)

**Key Points:**
- Each bed record in the JSON has its own address → stored in `farm_addresses` table
- Bed blocks are created from the "BogName" field (group multiple beds)
- API's "HandlerSectionName" is the actual bed identifier
- All tables use simple `id` as primary key (SERIAL autoincrement)
- API IDs stored as separate fields: `api_contract_id`, `api_bed_history_id`
- UPSERT operations via `ON CONFLICT DO UPDATE` for all tables
- Unique constraints on:
  - `farm_addresses`: (farm_id, street, city, state, postal_code)
  - `contracts`: (api_contract_id, crop_year)
  - `bed_blocks`: (contract_id, name)
  - `beds`: (api_bed_history_id)
- All database operations for a contract happen in a single transaction

## Status Reporting

The application provides detailed status reporting for both API and database operations:

**Per-Contract Logging:**
- API fetch status with record count and file path
- Database insert status with counts per table (farms, farm_addresses, contracts, bed_blocks, beds, shapes)
- Specific error messages for any failures

**Final Summary Report:**
- API statistics: total processed, successful, failed, total bed records
- Database statistics: successful inserts, failed inserts, total records per table (farms, farm addresses, contracts, bed blocks, beds, shapes)
- Detailed lists of:
  - Fully successful contracts (API + DB)
  - Contracts that fetched successfully but failed to insert into DB (with error details)
  - Contracts that failed to fetch from API
