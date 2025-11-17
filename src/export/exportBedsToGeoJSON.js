#!/usr/bin/env node
/**
 * Export All Farm Beds to GeoJSON for QGIS
 * -----------------------------------------
 * Generates a single GeoJSON file with all bed polygons from all farms
 * Output: output/beds_all_farms.geojson
 * Usage: npm run export-beds
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import pg from 'pg';

// Load environment variables
dotenv.config();

const OUTPUT_DIR = './output';
const GEOJSON_FILE = path.join(OUTPUT_DIR, 'beds_all_farms.geojson');

/**
 * Parse PostgreSQL polygon format to GeoJSON coordinates
 * Input: "((-89.64,44.30),(-89.63,44.30),...)"
 * Output: [[[-89.64, 44.30], [-89.63, 44.30], ...]]
 */
function parsePolygonToGeoJSON(polygonString) {
  try {
    // Remove outer parentheses and split into coordinate pairs
    const coordString = polygonString.replace(/^\(\(/, '').replace(/\)\)$/, '');
    const pairs = coordString.split('),(');

    const coordinates = pairs.map(pair => {
      const [lon, lat] = pair.split(',').map(parseFloat);
      return [lon, lat];
    });

    // GeoJSON polygons need an array of rings (first is outer, rest are holes)
    return [coordinates];
  } catch (error) {
    console.error('Error parsing polygon:', polygonString, error);
    return null;
  }
}

async function exportBedsToGeoJSON() {
  console.log('🗺️  Exporting All Farm Beds to GeoJSON...\n');

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

    // Query to get all beds with shapes and related data
    const query = `
      SELECT
        b.id as bed_id,
        b.bed_name,
        b.handler_section_name,
        b.acres,
        b.variety,
        b.plant_date,
        b.fruit_type_export,
        b.fruit_type_global_gap,
        b.fruit_type_organic,
        b.fruit_type_processed,
        b.fruit_type_white,
        bb.name as bed_block_name,
        c.contract_number,
        c.crop_year,
        f.id as farm_id,
        f.name as farm_name,
        s.shape_type,
        s.shape_value
      FROM beds b
      JOIN contracts c ON b.contract_id = c.id
      LEFT JOIN bed_blocks bb ON b.bed_block_id = bb.id
      LEFT JOIN farms f ON c.farm_id = f.id
      LEFT JOIN shapes s ON b.id = s.bed_id
      WHERE s.shape_value IS NOT NULL
      ORDER BY f.name, c.contract_number, b.bed_name
    `;

    const result = await client.query(query);

    if (result.rows.length === 0) {
      console.log('⚠️  No bed shapes found in database.\n');
      process.exit(0);
    }

    console.log(`📍 Found ${result.rows.length} bed shapes\n`);

    // Build GeoJSON structure
    const geojson = {
      type: 'FeatureCollection',
      name: 'Ocean Spray Grower Bed Polygons - All Farms',
      crs: {
        type: 'name',
        properties: {
          name: 'urn:ogc:def:crs:OGC:1.3:CRS84'
        }
      },
      features: []
    };

    let validShapes = 0;
    let invalidShapes = 0;

    // Convert each bed shape to a GeoJSON feature
    for (const row of result.rows) {
      // Parse polygon coordinates
      const coordinates = parsePolygonToGeoJSON(row.shape_value);

      if (!coordinates) {
        invalidShapes++;
        continue;
      }

      // Build fruit types array
      const fruitTypes = [];
      if (row.fruit_type_export) fruitTypes.push('Export');
      if (row.fruit_type_global_gap) fruitTypes.push('Global GAP');
      if (row.fruit_type_organic) fruitTypes.push('Organic');
      if (row.fruit_type_processed) fruitTypes.push('Processed');
      if (row.fruit_type_white) fruitTypes.push('White');

      const feature = {
        type: 'Feature',
        properties: {
          bed_id: row.bed_id,
          bed_name: row.bed_name,
          handler_section_name: row.handler_section_name,
          acres: row.acres ? parseFloat(row.acres) : 0,
          variety: row.variety,
          plant_date: row.plant_date ? row.plant_date.toISOString().split('T')[0] : null,
          bed_block_name: row.bed_block_name,
          farm_id: row.farm_id,
          farm_name: row.farm_name || 'Unknown Farm',
          contract_number: row.contract_number,
          crop_year: row.crop_year,
          fruit_types: fruitTypes.join(', '),
          is_organic: row.fruit_type_organic || false,
          is_export: row.fruit_type_export || false
        },
        geometry: {
          type: 'Polygon',
          coordinates: coordinates
        }
      };

      geojson.features.push(feature);
      validShapes++;
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
    console.log(`📊 File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`📍 Valid polygons: ${validShapes}`);
    if (invalidShapes > 0) {
      console.log(`⚠️  Invalid polygons skipped: ${invalidShapes}`);
    }

    // Calculate summary statistics
    const uniqueFarms = new Set(result.rows.map(r => r.farm_id)).size;
    const uniqueBeds = new Set(result.rows.map(r => r.bed_id)).size;
    const totalAcreage = result.rows.reduce((sum, r) => sum + parseFloat(r.acres || 0), 0);

    console.log('\n📊 SUMMARY STATISTICS');
    console.log('='.repeat(70));
    console.log(`Farms with bed data: ${uniqueFarms}`);
    console.log(`Total beds: ${uniqueBeds}`);
    console.log(`Total bed polygons: ${validShapes}`);
    console.log(`Total acreage: ${totalAcreage.toFixed(2)} acres`);
    console.log('='.repeat(70));

    console.log('\n📖 HOW TO USE IN QGIS:');
    console.log('1. Open QGIS');
    console.log('2. Layer → Add Layer → Add Vector Layer');
    console.log(`3. Browse to: ${path.resolve(GEOJSON_FILE)}`);
    console.log('4. Click "Add"');
    console.log('5. Style Options:');
    console.log('   - Categorize by "farm_name" to color by farm');
    console.log('   - Graduate by "acres" to show bed sizes');
    console.log('   - Filter by "is_organic" for organic beds only');
    console.log('   - Label with "bed_name" or "handler_section_name"\n');

    await client.end();

  } catch (error) {
    console.error('❌ Error exporting to GeoJSON:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
  }
}

exportBedsToGeoJSON();
