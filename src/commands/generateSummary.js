#!/usr/bin/env node
/**
 * Summary Report Generator
 * -------------------------
 * Generates a summary report of contracts with farm names and total acres
 * Displays in terminal and saves to output/summary.csv
 * Usage: npm run summary
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import pg from 'pg';

// Load environment variables
dotenv.config();

const OUTPUT_DIR = './output';
const CSV_FILE = path.join(OUTPUT_DIR, 'summary.csv');

async function generateSummary() {
  console.log('📊 Generating Contract Summary Report...\n');

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

    // Query for contract summary grouped by farm name
    const query = `
      WITH contract_totals AS (
        SELECT
          c.contract_number,
          c.farm_id,
          COALESCE(f.name, 'Unknown Farm') as farm_name,
          COALESCE(SUM(b.acres), 0) as acres
        FROM contracts c
        LEFT JOIN farms f ON c.farm_id = f.id
        LEFT JOIN beds b ON c.id = b.contract_id
        GROUP BY c.contract_number, c.farm_id, f.name
      ),
      farm_addresses_grouped AS (
        SELECT
          f.name as farm_name,
          array_agg(DISTINCT
            TRIM(
              CONCAT_WS(', ',
                NULLIF(fa.street, ''),
                NULLIF(fa.street2, ''),
                NULLIF(fa.city, ''),
                NULLIF(fa.state, ''),
                NULLIF(fa.postal_code, ''),
                NULLIF(fa.country, '')
              )
            )
          ) FILTER (WHERE fa.street IS NOT NULL OR fa.city IS NOT NULL) as addresses
        FROM farms f
        LEFT JOIN farm_addresses fa ON f.id = fa.farm_id
        GROUP BY f.name
      )
      SELECT
        ct.farm_name,
        array_agg(ct.contract_number ORDER BY ct.contract_number) as contract_numbers,
        array_agg(ct.acres ORDER BY ct.contract_number) as individual_acres,
        SUM(ct.acres) as total_acres,
        fag.addresses
      FROM contract_totals ct
      LEFT JOIN farm_addresses_grouped fag ON ct.farm_name = fag.farm_name
      GROUP BY ct.farm_name, fag.addresses
      ORDER BY SUM(ct.acres) DESC
    `;

    const result = await client.query(query);

    if (result.rows.length === 0) {
      console.log('⚠️  No data found in database. Run "npm start" first to fetch contract data.\n');
      process.exit(0);
    }

    // Format results for display
    const formattedResults = result.rows.map((row, index) => {
      const contractNumbers = row.contract_numbers.join(', ');

      // Format acres with breakdown if multiple contracts
      let acresDisplay;
      if (row.individual_acres.length > 1) {
        const breakdown = row.individual_acres.map(a => parseFloat(a).toFixed(2)).join(' + ');
        acresDisplay = `${parseFloat(row.total_acres).toFixed(2)} (${breakdown})`;
      } else {
        acresDisplay = parseFloat(row.total_acres).toFixed(2);
      }

      // Format addresses
      let addressesDisplay = '';
      if (row.addresses && row.addresses.length > 0) {
        addressesDisplay = row.addresses.filter(a => a !== null).join('; ');
      }

      return {
        '#': index + 1,  // Start index at 1
        farm_name: row.farm_name,
        contract_numbers: contractNumbers,
        total_acres: acresDisplay,
        addresses: addressesDisplay
      };
    });

    // Display results in terminal as table
    console.log('📋 Contract Summary (Grouped by Farm):');
    console.log('='.repeat(100));
    console.table(formattedResults);
    console.log('='.repeat(100));
    console.log(`Total Farms: ${result.rows.length}`);

    // Count total contracts
    const totalContracts = result.rows.reduce((sum, row) => sum + row.contract_numbers.length, 0);
    console.log(`Total Contracts: ${totalContracts}\n`);

    // Calculate grand total acres
    const grandTotal = result.rows.reduce((sum, row) => sum + parseFloat(row.total_acres || 0), 0);
    console.log(`📏 Grand Total Acres: ${grandTotal.toFixed(2)}\n`);

    // Create output directory if it doesn't exist
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Write CSV file with formatted data
    const csvHeader = 'index,farm_name,contract_numbers,total_acres,addresses\n';
    const csvRows = formattedResults.map(row =>
      `${row['#']},"${row.farm_name}","${row.contract_numbers}","${row.total_acres}","${row.addresses}"`
    ).join('\n');
    const csvContent = csvHeader + csvRows;

    fs.writeFileSync(CSV_FILE, csvContent, 'utf8');
    console.log(`💾 Summary saved to: ${CSV_FILE}`);

    // Show file size
    const stats = fs.statSync(CSV_FILE);
    console.log(`   File size: ${stats.size} bytes`);
    console.log(`   Records: ${result.rows.length}\n`);

    await client.end();
    console.log('✅ Summary generation complete!\n');

  } catch (error) {
    console.error('❌ Error generating summary:', error.message);
    console.error('   Make sure the database is set up. Run "npm run sql" first.\n');
    process.exit(1);
  }
}

generateSummary();
