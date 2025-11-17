#!/usr/bin/env node
/**
 * Ocean Spray Grower API Contract Fetcher
 * ----------------------------------------
 * Usage:
 *   1. Create "contracts.txt" with one contractNumber per line.
 *   2. Run: npm install (first time only)
 *   3. Configure .env file with API token and database credentials
 *   4. Run: node fetchContracts.js
 *   5. JSON results will be saved in ./data/{cropYear}/{contractNumber}.json
 *   6. Data will be inserted into PostgreSQL database
 */

import fs from "fs";
import path from "path";
import axios from "axios";
import readline from "readline";
import dotenv from "dotenv";
import pg from "pg";

// Load environment variables
dotenv.config();

const API_URL = "https://grower-gbs-prod.oceanspray.io/v1";
const DATA_DIR = "./data";
const CONTRACTS_FILE = "./input/contracts.txt";

// Database connection pool
const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

/** Prompt helper */
function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

/** Read contract numbers from file */
function readContractNumbers() {
  if (!fs.existsSync(CONTRACTS_FILE)) {
    console.error(`❌ Missing ${CONTRACTS_FILE}. Please create it first.`);
    process.exit(1);
  }

  const contents = fs.readFileSync(CONTRACTS_FILE, "utf8");
  return contents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Insert or update farm record (without address) */
async function insertOrUpdateFarm(client) {
  const query = `
    INSERT INTO farms (name)
    VALUES (NULL)
    ON CONFLICT DO NOTHING
    RETURNING id
  `;

  // For now, create a farm with NULL name (can be updated later with actual farm data)
  // We'll just insert a farm if it doesn't exist based on contract
  const result = await client.query(query);

  if (result.rows.length > 0) {
    return result.rows[0].id;
  }

  // If no rows returned (conflict), we need to get existing farm
  // For simplicity, just create a new farm each time for now
  const insertQuery = `INSERT INTO farms DEFAULT VALUES RETURNING id`;
  const insertResult = await client.query(insertQuery);
  return insertResult.rows[0].id;
}

/** Insert or update farm address */
async function insertOrUpdateFarmAddress(client, farmId, addressData) {
  const query = `
    INSERT INTO farm_addresses (farm_id, street, street2, city, state, postal_code, country)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (farm_id, street, city, state, postal_code)
    DO UPDATE SET
      street2 = EXCLUDED.street2,
      country = EXCLUDED.country,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `;

  const result = await client.query(query, [
    farmId,
    addressData.Street1,
    addressData.Street2,
    addressData.City,
    addressData.State,
    addressData.PostalCode,
    addressData.Country
  ]);

  return result.rows[0].id;
}

/** Insert or update contract record */
async function insertOrUpdateContract(client, apiContractId, contractNumber, farmId, cropYear) {
  const query = `
    INSERT INTO contracts (api_contract_id, contract_number, farm_id, crop_year)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (api_contract_id, crop_year)
    DO UPDATE SET
      contract_number = EXCLUDED.contract_number,
      farm_id = EXCLUDED.farm_id,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `;

  const result = await client.query(query, [apiContractId, contractNumber, farmId, cropYear]);
  return result.rows[0].id;
}

/** Insert or update bed block record */
async function insertOrUpdateBedBlock(client, contractId, blockName) {
  const query = `
    INSERT INTO bed_blocks (contract_id, name)
    VALUES ($1, $2)
    ON CONFLICT (contract_id, name)
    DO UPDATE SET
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `;

  const result = await client.query(query, [contractId, blockName]);
  return result.rows[0].id;
}

/** Insert or update bed record */
async function insertOrUpdateBed(client, bedData, contractId, bedBlockId, farmAddressId) {
  const query = `
    INSERT INTO beds (
      api_bed_history_id, contract_id, bed_block_id, farm_address_id,
      bed_name, handler_section_name, acres, variety, plant_date,
      fruit_type_export, fruit_type_global_gap, fruit_type_organic,
      fruit_type_processed, fruit_type_white
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT (api_bed_history_id)
    DO UPDATE SET
      contract_id = EXCLUDED.contract_id,
      bed_block_id = EXCLUDED.bed_block_id,
      farm_address_id = EXCLUDED.farm_address_id,
      bed_name = EXCLUDED.bed_name,
      handler_section_name = EXCLUDED.handler_section_name,
      acres = EXCLUDED.acres,
      variety = EXCLUDED.variety,
      plant_date = EXCLUDED.plant_date,
      fruit_type_export = EXCLUDED.fruit_type_export,
      fruit_type_global_gap = EXCLUDED.fruit_type_global_gap,
      fruit_type_organic = EXCLUDED.fruit_type_organic,
      fruit_type_processed = EXCLUDED.fruit_type_processed,
      fruit_type_white = EXCLUDED.fruit_type_white,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `;

  const result = await client.query(query, [
    bedData.BedHistoryId,
    contractId,
    bedBlockId,
    farmAddressId,
    bedData.HandlerSectionName, // bed_name is the handler section name
    bedData.HandlerSectionName, // also store in handler_section_name for reference
    bedData.Acres,
    bedData.Variety,
    bedData.PlantDate,
    bedData.FruitType.Export,
    bedData.FruitType.GlobalGap,
    bedData.FruitType.Organic,
    bedData.FruitType.Processed,
    bedData.FruitType.White
  ]);

  return result.rows[0].id;
}

/** Insert or update shape record */
async function insertOrUpdateShape(client, bedId, shape) {
  // First, delete existing shapes for this bed to avoid duplicates
  await client.query('DELETE FROM shapes WHERE bed_id = $1', [bedId]);

  const query = `
    INSERT INTO shapes (bed_id, shape_type, shape_value)
    VALUES ($1, $2, $3)
    RETURNING id
  `;

  await client.query(query, [bedId, shape.type, shape.value]);
}

/** Insert all data from JSON response into database */
async function insertIntoDatabase(contractData, cropYear) {
  const client = await pool.connect();
  const stats = {
    farms: 0,
    farm_addresses: 0,
    contracts: 0,
    bed_blocks: 0,
    beds: 0,
    shapes: 0
  };

  try {
    await client.query('BEGIN');

    if (!contractData || contractData.length === 0) {
      throw new Error('No data to insert');
    }

    const firstRecord = contractData[0];

    // Create farm (one per contract for now)
    const farmId = await insertOrUpdateFarm(client);
    stats.farms = 1;

    // Insert contract and get internal ID
    const contractId = await insertOrUpdateContract(
      client,
      firstRecord.ContractId,
      firstRecord.ContractNumber,
      farmId,
      cropYear
    );
    stats.contracts = 1;

    // Track unique addresses and bed blocks
    const addressCache = new Map(); // Key: address string, Value: farm_address_id
    const bedBlockCache = new Map(); // Key: block name, Value: bed_block_id

    // Process each bed record
    for (const bedRecord of contractData) {
      // Create unique address key
      const addressKey = `${bedRecord.Address.Street1}|${bedRecord.Address.City}|${bedRecord.Address.State}|${bedRecord.Address.PostalCode}`;

      // Get or create farm address
      let farmAddressId;
      if (addressCache.has(addressKey)) {
        farmAddressId = addressCache.get(addressKey);
      } else {
        farmAddressId = await insertOrUpdateFarmAddress(client, farmId, bedRecord.Address);
        addressCache.set(addressKey, farmAddressId);
        stats.farm_addresses++;
      }

      // Get or create bed block
      const blockName = bedRecord.BogName;
      let bedBlockId;
      if (bedBlockCache.has(blockName)) {
        bedBlockId = bedBlockCache.get(blockName);
      } else {
        bedBlockId = await insertOrUpdateBedBlock(client, contractId, blockName);
        bedBlockCache.set(blockName, bedBlockId);
        stats.bed_blocks++;
      }

      // Insert bed
      const bedId = await insertOrUpdateBed(client, bedRecord, contractId, bedBlockId, farmAddressId);
      stats.beds++;

      // Insert shapes for this bed
      if (bedRecord.Shape && Array.isArray(bedRecord.Shape)) {
        for (const shape of bedRecord.Shape) {
          await insertOrUpdateShape(client, bedId, shape);
          stats.shapes++;
        }
      }
    }

    await client.query('COMMIT');
    return { success: true, stats };

  } catch (error) {
    await client.query('ROLLBACK');
    return { success: false, error: error.message, stats };
  } finally {
    client.release();
  }
}

/** Fetch and save JSON for a single contract */
async function fetchAndSave(contractNumber, token, cropYear) {
  const result = {
    contractNumber,
    api: { success: false },
    db: { success: false }
  };

  // Step 1: Fetch from API
  try {
    const url = `${API_URL}/bog/${contractNumber}`;
    const response = await axios.get(url, {
      headers: { "Content-Type": "application/json" },
      params: { token, cropYear },
    });

    // Create data directory and cropYear subdirectory if they don't exist
    const yearDir = path.join(DATA_DIR, String(cropYear));
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
    if (!fs.existsSync(yearDir)) fs.mkdirSync(yearDir);

    const outputFile = path.join(yearDir, `${contractNumber}.json`);
    fs.writeFileSync(outputFile, JSON.stringify(response.data, null, 2));

    const recordCount = Array.isArray(response.data) ? response.data.length : 1;
    result.api = {
      success: true,
      recordCount,
      filePath: `${cropYear}/${contractNumber}.json`
    };

    console.log(`✅ API SUCCESS: ${contractNumber} - Fetched ${recordCount} bed record(s), saved to ${cropYear}/${contractNumber}.json`);

    // Step 2: Insert into Database
    try {
      const dbResult = await insertIntoDatabase(response.data, cropYear);

      if (dbResult.success) {
        result.db = {
          success: true,
          stats: dbResult.stats
        };
        console.log(`✅ DB SUCCESS: ${contractNumber} - Inserted ${dbResult.stats.farms} farm(s), ${dbResult.stats.farm_addresses} address(es), ${dbResult.stats.contracts} contract(s), ${dbResult.stats.bed_blocks} block(s), ${dbResult.stats.beds} bed(s), ${dbResult.stats.shapes} shape(s)`);
      } else {
        result.db = {
          success: false,
          error: dbResult.error,
          stats: dbResult.stats
        };
        console.error(`❌ DB FAILED: ${contractNumber} - ${dbResult.error}`);
      }

    } catch (dbErr) {
      result.db = {
        success: false,
        error: dbErr.message
      };
      console.error(`❌ DB FAILED: ${contractNumber} - ${dbErr.message}`);
    }

  } catch (err) {
    const statusCode = err.response?.status || "N/A";
    const errorMsg = err.response?.data?.message || err.message;
    result.api = {
      success: false,
      statusCode,
      error: errorMsg
    };
    console.error(`❌ API FAILED: ${contractNumber} - HTTP ${statusCode}: ${errorMsg}`);
  }

  return result;
}

/** Main */
(async () => {
  console.log("🔍 Ocean Spray Contract Fetcher with Database Integration\n");

  // Test database connection
  try {
    await pool.query('SELECT NOW()');
    console.log("✅ Database connection successful\n");
  } catch (err) {
    console.error("❌ Database connection failed:", err.message);
    console.error("   Please check your .env configuration\n");
    process.exit(1);
  }

  const token = process.env.OCEANSPRAY_API_TOKEN || await ask("Enter your Ocean Spray API token: ");
  const defaultYear = new Date().getFullYear();
  const yearInput = await ask(`Enter crop year [default: ${defaultYear}]: `);
  const cropYear = yearInput || defaultYear;

  const contracts = readContractNumbers();
  console.log(`\n📦 Processing ${contracts.length} contract(s) for crop year ${cropYear}...\n`);

  const results = [];
  for (const contract of contracts) {
    const result = await fetchAndSave(contract, token, cropYear);
    results.push(result);
    console.log(""); // Blank line between contracts
  }

  // Calculate statistics
  const apiSuccess = results.filter(r => r.api.success);
  const apiFailed = results.filter(r => !r.api.success);
  const dbSuccess = results.filter(r => r.db.success);
  const dbFailed = results.filter(r => r.api.success && !r.db.success);
  const totalRecords = apiSuccess.reduce((sum, r) => sum + (r.api.recordCount || 0), 0);

  // Calculate total DB insertions
  let totalFarms = 0, totalFarmAddresses = 0, totalContracts = 0, totalBedBlocks = 0, totalBeds = 0, totalShapes = 0;
  dbSuccess.forEach(r => {
    if (r.db.stats) {
      totalFarms += r.db.stats.farms;
      totalFarmAddresses += r.db.stats.farm_addresses;
      totalContracts += r.db.stats.contracts;
      totalBedBlocks += r.db.stats.bed_blocks;
      totalBeds += r.db.stats.beds;
      totalShapes += r.db.stats.shapes;
    }
  });

  // Print comprehensive summary
  console.log("=".repeat(70));
  console.log("📊 FINAL SUMMARY");
  console.log("=".repeat(70));

  console.log("\n📡 API FETCH RESULTS:");
  console.log(`   Total Contracts Processed: ${results.length}`);
  console.log(`   ✅ Successful: ${apiSuccess.length}`);
  console.log(`   ❌ Failed: ${apiFailed.length}`);
  console.log(`   📝 Total Bed Records Fetched: ${totalRecords}`);

  console.log("\n💾 DATABASE INSERT RESULTS:");
  console.log(`   ✅ Successfully Inserted: ${dbSuccess.length}`);
  console.log(`   ❌ Failed to Insert: ${dbFailed.length}`);
  console.log(`   📊 Total Records Inserted:`);
  console.log(`      - Farms: ${totalFarms}`);
  console.log(`      - Farm Addresses: ${totalFarmAddresses}`);
  console.log(`      - Contracts: ${totalContracts}`);
  console.log(`      - Bed Blocks: ${totalBedBlocks}`);
  console.log(`      - Beds: ${totalBeds}`);
  console.log(`      - Shapes: ${totalShapes}`);

  // Detailed breakdown
  const fullSuccess = results.filter(r => r.api.success && r.db.success);
  const apiOnlySuccess = results.filter(r => r.api.success && !r.db.success);

  if (fullSuccess.length > 0) {
    console.log("\n✅ FULLY SUCCESSFUL (API + DB):");
    fullSuccess.forEach(r => {
      console.log(`   - ${r.contractNumber}: ${r.api.recordCount} bed(s) → ${r.api.filePath}`);
      if (r.db.stats) {
        console.log(`     DB: ${r.db.stats.farms} farm(s), ${r.db.stats.farm_addresses} address(es), ${r.db.stats.contracts} contract(s), ${r.db.stats.bed_blocks} block(s), ${r.db.stats.beds} bed(s), ${r.db.stats.shapes} shape(s)`);
      }
    });
  }

  if (apiOnlySuccess.length > 0) {
    console.log("\n⚠️  API SUCCESS BUT DB FAILED:");
    apiOnlySuccess.forEach(r => {
      console.log(`   - ${r.contractNumber}: ${r.api.filePath}`);
      console.log(`     Error: ${r.db.error || 'Unknown error'}`);
    });
  }

  if (apiFailed.length > 0) {
    console.log("\n❌ API FETCH FAILED:");
    apiFailed.forEach(r => {
      console.log(`   - ${r.contractNumber}: HTTP ${r.api.statusCode} - ${r.api.error}`);
    });
  }

  console.log("\n" + "=".repeat(70));
  console.log(`🎉 Processing Complete!`);
  console.log(`   JSON Files: ./data/${cropYear}/`);
  console.log(`   Database: ${process.env.DB_NAME} on ${process.env.DB_HOST}`);
  console.log("=".repeat(70) + "\n");

  await pool.end();
})();
