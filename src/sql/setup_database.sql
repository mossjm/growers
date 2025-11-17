-- Database Setup Script for Ocean Spray Growers Project
-- ========================================================
-- This script creates the growers database.
-- Run this BEFORE running schema.sql
--
-- Usage:
--   Find your psql command location first:
--     find /Applications /usr/local /Library -name psql 2>/dev/null
--
--   Then run with full path:
--     /path/to/psql -U postgres -f setup_database.sql
--
--   Or if psql is in your PATH:
--     psql -U postgres -f setup_database.sql
--
-- After running this, run schema.sql:
--     /path/to/psql -d growers -f schema.sql

-- Uncomment the next line if you want to drop and recreate the database
-- WARNING: This will delete all existing data!
-- DROP DATABASE IF EXISTS growers;

-- Create the database
CREATE DATABASE growers
    ENCODING = 'UTF8'
    LC_COLLATE = 'en_US.UTF-8'
    LC_CTYPE = 'en_US.UTF-8'
    TEMPLATE = template0;

-- Connect to the new database to verify it was created
\c growers

-- Display success message
SELECT 'Database "growers" created successfully!' AS status;
SELECT 'Next step: Run schema.sql to create tables' AS next_step;
SELECT '  Example: psql -d growers -f schema.sql' AS command;
