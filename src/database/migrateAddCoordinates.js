#!/usr/bin/env node
/**
 * Database Migration: Add Coordinates to Farm Addresses
 * ------------------------------------------------------
 * Adds latitude and longitude columns to farm_addresses table
 * Usage: node migrateAddCoordinates.js
 */

import dotenv from 'dotenv';
import pg from 'pg';

// Load environment variables
dotenv.config();

async function migrate() {
  console.log('🔄 Running migration: Add coordinates to farm_addresses...\n');

  const client = new pg.Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Check if columns already exist
    const checkQuery = `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'farm_addresses'
        AND column_name IN ('latitude', 'longitude')
    `;

    const checkResult = await client.query(checkQuery);

    if (checkResult.rows.length === 2) {
      console.log('✅ Columns already exist! Migration not needed.\n');
      await client.end();
      return;
    }

    console.log('🔧 Adding latitude and longitude columns...\n');

    // Add latitude column if it doesn't exist
    if (!checkResult.rows.find(r => r.column_name === 'latitude')) {
      await client.query(`
        ALTER TABLE farm_addresses
        ADD COLUMN latitude DECIMAL(10, 8)
      `);
      console.log('✅ Added latitude column');
    }

    // Add longitude column if it doesn't exist
    if (!checkResult.rows.find(r => r.column_name === 'longitude')) {
      await client.query(`
        ALTER TABLE farm_addresses
        ADD COLUMN longitude DECIMAL(11, 8)
      `);
      console.log('✅ Added longitude column');
    }

    // Create index for better query performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_farm_addresses_coordinates
      ON farm_addresses(latitude, longitude)
    `);
    console.log('✅ Created coordinates index\n');

    // Show table structure
    const structureQuery = `
      SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_name = 'farm_addresses'
      ORDER BY ordinal_position
    `;

    const structureResult = await client.query(structureQuery);
    console.log('📊 Updated farm_addresses table structure:');
    console.table(structureResult.rows);

    await client.end();
    console.log('✅ Migration complete!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
  }
}

migrate();
