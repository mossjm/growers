#!/usr/bin/env node
/**
 * Update Farm Names from GrowerList2024.json
 * -------------------------------------------
 * Looks up farm names by contract number and updates the farms table
 * Usage: node updateFarmNames.js
 */

import fs from 'fs';
import dotenv from 'dotenv';
import pg from 'pg';

// Load environment variables
dotenv.config();

async function updateFarmNames() {
  console.log('🔄 Updating farm names from GrowerList2024.json...\n');

  // Read GrowerList2024.json
  const growerList = JSON.parse(fs.readFileSync('./input/GrowerList2024.json', 'utf8'));

  // Create a map of contract number to farm name
  // extBpId is the contract number field in the JSON
  const contractToFarmName = new Map();
  for (const grower of growerList) {
    if (grower.extBpId && grower.bpName) {
      contractToFarmName.set(grower.extBpId, grower.bpName);
    }
  }

  console.log(`📋 Loaded ${contractToFarmName.size} grower records from JSON\n`);

  // Connect to database
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

    // Get all contracts with their farm_id and contract_number
    const contractsQuery = `
      SELECT c.id as contract_id, c.contract_number, c.farm_id, f.name as current_farm_name
      FROM contracts c
      LEFT JOIN farms f ON c.farm_id = f.id
      ORDER BY c.contract_number
    `;

    const contractsResult = await client.query(contractsQuery);
    console.log(`📊 Found ${contractsResult.rows.length} contracts in database\n`);

    let updatedCount = 0;
    let notFoundCount = 0;
    let alreadySetCount = 0;

    console.log('🔄 Processing updates...\n');

    // Process each contract
    for (const contract of contractsResult.rows) {
      const farmName = contractToFarmName.get(contract.contract_number);

      if (!farmName) {
        notFoundCount++;
        console.log(`⚠️  Contract ${contract.contract_number}: Farm name not found in GrowerList`);
        continue;
      }

      // Check if name is already set correctly
      if (contract.current_farm_name === farmName) {
        alreadySetCount++;
        continue;
      }

      // Update the farm name
      const updateQuery = `
        UPDATE farms
        SET name = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `;

      await client.query(updateQuery, [farmName, contract.farm_id]);
      updatedCount++;
      console.log(`✅ Contract ${contract.contract_number}: Updated farm name to "${farmName}"`);
    }

    console.log('\n' + '='.repeat(70));
    console.log('📊 UPDATE SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total Contracts Processed: ${contractsResult.rows.length}`);
    console.log(`✅ Updated: ${updatedCount}`);
    console.log(`✓  Already Correct: ${alreadySetCount}`);
    console.log(`⚠️  Not Found in GrowerList: ${notFoundCount}`);
    console.log('='.repeat(70) + '\n');

    // Show sample of updated farms
    if (updatedCount > 0) {
      const sampleQuery = `
        SELECT f.id, f.name, c.contract_number
        FROM farms f
        JOIN contracts c ON f.id = c.farm_id
        WHERE f.name IS NOT NULL
        ORDER BY f.updated_at DESC
        LIMIT 10
      `;

      const sampleResult = await client.query(sampleQuery);
      console.log('📋 Sample of updated farms (last 10):');
      console.table(sampleResult.rows);
    }

    await client.end();
    console.log('✅ Update complete!\n');

  } catch (error) {
    console.error('❌ Error updating farm names:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
  }
}

updateFarmNames();
