#!/usr/bin/env node
/**
 * Export Farm Data to GeoJSON for QGIS
 * -------------------------------------
 * Generates a GeoJSON file with farm locations, names, and acreage data
 * Output: output/farms.geojson
 * Usage: npm run export-geojson
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import pg from 'pg';

// Load environment variables
dotenv.config();

const OUTPUT_DIR = './output';
const GEOJSON_FILE = path.join(OUTPUT_DIR, 'farms.geojson');

async function exportToGeoJSON() {
  console.log('🗺️  Exporting Farm Data to GeoJSON...\n');

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

    // Query to get farms with their addresses and contract data
    const query = `
      WITH farm_contracts AS (
        SELECT
          f.id as farm_id,
          f.name as farm_name,
          array_agg(c.contract_number ORDER BY c.contract_number) as contract_numbers,
          SUM(b.acres) as total_acres
        FROM farms f
        LEFT JOIN contracts c ON f.id = c.farm_id
        LEFT JOIN beds b ON c.id = b.contract_id
        GROUP BY f.id, f.name
      )
      SELECT
        fc.farm_id,
        fc.farm_name,
        fc.contract_numbers,
        fc.total_acres,
        fa.id as address_id,
        fa.street,
        fa.street2,
        fa.city,
        fa.state,
        fa.postal_code,
        fa.country,
        fa.latitude,
        fa.longitude
      FROM farm_contracts fc
      INNER JOIN farm_addresses fa ON fc.farm_id = fa.farm_id
      WHERE fa.latitude IS NOT NULL AND fa.longitude IS NOT NULL
      ORDER BY fc.total_acres DESC, fc.farm_name
    `;

    const result = await client.query(query);

    if (result.rows.length === 0) {
      console.log('⚠️  No geocoded addresses found. Run "npm run geocode" first.\n');
      process.exit(0);
    }

    console.log(`📍 Found ${result.rows.length} geocoded farm locations\n`);

    // Build GeoJSON structure
    const geojson = {
      type: 'FeatureCollection',
      name: 'Ocean Spray Grower Farms',
      crs: {
        type: 'name',
        properties: {
          name: 'urn:ogc:def:crs:OGC:1.3:CRS84'
        }
      },
      features: []
    };

    // Convert each row to a GeoJSON feature
    for (const row of result.rows) {
      // Build full address string
      const addressParts = [];
      if (row.street) addressParts.push(row.street);
      if (row.street2) addressParts.push(row.street2);
      if (row.city) addressParts.push(row.city);
      if (row.state) addressParts.push(row.state);
      if (row.postal_code) addressParts.push(row.postal_code);
      if (row.country) addressParts.push(row.country);
      const fullAddress = addressParts.join(', ');

      // Format contract numbers
      const contractNumbers = row.contract_numbers ? row.contract_numbers.join(', ') : '';

      // Format acres
      const totalAcres = row.total_acres ? parseFloat(row.total_acres).toFixed(2) : '0.00';

      const feature = {
        type: 'Feature',
        properties: {
          farm_id: row.farm_id,
          farm_name: row.farm_name || 'Unknown Farm',
          contract_numbers: contractNumbers,
          total_acres: parseFloat(totalAcres),
          address: fullAddress,
          city: row.city,
          state: row.state,
          postal_code: row.postal_code
        },
        geometry: {
          type: 'Point',
          coordinates: [
            parseFloat(row.longitude),
            parseFloat(row.latitude)
          ]
        }
      };

      geojson.features.push(feature);
    }

    // Create output directory if it doesn't exist
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Write GeoJSON file
    fs.writeFileSync(GEOJSON_FILE, JSON.stringify(geojson, null, 2), 'utf8');

    console.log('✅ GeoJSON file created successfully!\n');
    console.log(`📁 File: ${GEOJSON_FILE}`);

    // Show file statistics
    const stats = fs.statSync(GEOJSON_FILE);
    console.log(`📊 File size: ${(stats.size / 1024).toFixed(2)} KB`);
    console.log(`📍 Total features: ${geojson.features.length}\n`);

    // Show summary statistics
    const uniqueFarms = new Set(result.rows.map(r => r.farm_id)).size;
    const totalAcreage = result.rows.reduce((sum, r) => {
      // Avoid double-counting by only counting unique farms
      return sum;
    }, 0);

    // Calculate total acreage from unique farms
    const farmAcreages = {};
    for (const row of result.rows) {
      if (!farmAcreages[row.farm_id]) {
        farmAcreages[row.farm_id] = parseFloat(row.total_acres || 0);
      }
    }
    const grandTotalAcreage = Object.values(farmAcreages).reduce((sum, acres) => sum + acres, 0);

    console.log('📊 SUMMARY STATISTICS');
    console.log('='.repeat(70));
    console.log(`Unique Farms: ${uniqueFarms}`);
    console.log(`Total Locations: ${geojson.features.length}`);
    console.log(`Grand Total Acreage: ${grandTotalAcreage.toFixed(2)} acres`);
    console.log('='.repeat(70));

    console.log('\n📖 HOW TO USE IN QGIS:');
    console.log('1. Open QGIS');
    console.log('2. Layer → Add Layer → Add Vector Layer');
    console.log(`3. Browse to: ${path.resolve(GEOJSON_FILE)}`);
    console.log('4. Click "Add"');
    console.log('5. Right-click layer → Properties → Labels to show farm names');
    console.log('6. Use "total_acres" field for graduated symbols or heat maps\n');

    await client.end();

  } catch (error) {
    console.error('❌ Error exporting to GeoJSON:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
  }
}

exportToGeoJSON();
