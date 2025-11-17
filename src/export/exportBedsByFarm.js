#!/usr/bin/env node
/**
 * Export Farm Beds by Individual Farm to GeoJSON for QGIS
 * --------------------------------------------------------
 * Generates separate GeoJSON files for each farm
 * Output: output/farms/{farm_name}.geojson
 * Usage: npm run export-beds-by-farm
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import pg from 'pg';

// Load environment variables
dotenv.config();

const OUTPUT_DIR = './output/farms';

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

/**
 * Sanitize filename by replacing invalid characters
 */
function sanitizeFilename(name) {
  return name
    .replace(/[^a-z0-9]/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

async function exportBedsByFarm() {
  console.log('🗺️  Exporting Farm Beds by Individual Farm to GeoJSON...\n');

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

    // First, get list of farms with bed data
    const farmsQuery = `
      SELECT DISTINCT
        f.id as farm_id,
        f.name as farm_name,
        COUNT(DISTINCT b.id) as bed_count
      FROM farms f
      JOIN contracts c ON f.id = c.farm_id
      JOIN beds b ON c.id = b.contract_id
      JOIN shapes s ON b.id = s.bed_id
      WHERE s.shape_value IS NOT NULL
      GROUP BY f.id, f.name
      ORDER BY f.name
    `;

    const farmsResult = await client.query(farmsQuery);

    if (farmsResult.rows.length === 0) {
      console.log('⚠️  No farms with bed shapes found in database.\n');
      process.exit(0);
    }

    console.log(`📋 Found ${farmsResult.rows.length} farms with bed data\n`);

    // Create output directory
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    let totalFiles = 0;
    let totalBeds = 0;
    let totalAcreage = 0;

    console.log('🔄 Exporting farms...\n');
    console.log('-'.repeat(70));

    // Process each farm
    for (const farm of farmsResult.rows) {
      const farmName = farm.farm_name || 'Unknown_Farm';
      const filename = sanitizeFilename(farmName) + '.geojson';
      const filepath = path.join(OUTPUT_DIR, filename);

      // Query beds for this specific farm
      const bedsQuery = `
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
          s.shape_type,
          s.shape_value
        FROM beds b
        JOIN contracts c ON b.contract_id = c.id
        LEFT JOIN bed_blocks bb ON b.bed_block_id = bb.id
        JOIN farms f ON c.farm_id = f.id
        LEFT JOIN shapes s ON b.id = s.bed_id
        WHERE f.id = $1 AND s.shape_value IS NOT NULL
        ORDER BY c.contract_number, b.bed_name
      `;

      const bedsResult = await client.query(bedsQuery, [farm.farm_id]);

      // Build GeoJSON structure for this farm
      const geojson = {
        type: 'FeatureCollection',
        name: `${farmName} - Bed Polygons`,
        crs: {
          type: 'name',
          properties: {
            name: 'urn:ogc:def:crs:OGC:1.3:CRS84'
          }
        },
        features: []
      };

      let validShapes = 0;
      let farmAcreage = 0;

      // Convert each bed shape to a GeoJSON feature
      for (const row of bedsResult.rows) {
        // Parse polygon coordinates
        const coordinates = parsePolygonToGeoJSON(row.shape_value);

        if (!coordinates) {
          continue;
        }

        // Build fruit types array
        const fruitTypes = [];
        if (row.fruit_type_export) fruitTypes.push('Export');
        if (row.fruit_type_global_gap) fruitTypes.push('Global GAP');
        if (row.fruit_type_organic) fruitTypes.push('Organic');
        if (row.fruit_type_processed) fruitTypes.push('Processed');
        if (row.fruit_type_white) fruitTypes.push('White');

        const acres = row.acres ? parseFloat(row.acres) : 0;
        farmAcreage += acres;

        const feature = {
          type: 'Feature',
          properties: {
            bed_id: row.bed_id,
            bed_name: row.bed_name,
            handler_section_name: row.handler_section_name,
            acres: acres,
            variety: row.variety,
            plant_date: row.plant_date ? row.plant_date.toISOString().split('T')[0] : null,
            bed_block_name: row.bed_block_name,
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

      // Write GeoJSON file for this farm
      fs.writeFileSync(filepath, JSON.stringify(geojson, null, 2), 'utf8');

      console.log(`✅ ${farmName}`);
      console.log(`   → ${validShapes} beds, ${farmAcreage.toFixed(2)} acres`);
      console.log(`   → ${filename}`);

      totalFiles++;
      totalBeds += validShapes;
      totalAcreage += farmAcreage;
    }

    console.log('-'.repeat(70));
    console.log('\n📊 EXPORT SUMMARY');
    console.log('='.repeat(70));
    console.log(`Farms exported: ${totalFiles}`);
    console.log(`Total beds: ${totalBeds}`);
    console.log(`Total acreage: ${totalAcreage.toFixed(2)} acres`);
    console.log(`Output directory: ${path.resolve(OUTPUT_DIR)}`);
    console.log('='.repeat(70));

    console.log('\n📖 HOW TO USE IN QGIS:');
    console.log('1. Open QGIS');
    console.log('2. Layer → Add Layer → Add Vector Layer');
    console.log(`3. Browse to: ${path.resolve(OUTPUT_DIR)}`);
    console.log('4. Select one or more .geojson files');
    console.log('5. Click "Add"');
    console.log('6. Each farm will be loaded as a separate layer\n');

    await client.end();

  } catch (error) {
    console.error('❌ Error exporting to GeoJSON:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
  }
}

exportBedsByFarm();
