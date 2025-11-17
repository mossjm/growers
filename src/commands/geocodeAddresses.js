#!/usr/bin/env node
/**
 * Geocode Farm Addresses using US Census Geocoder + OpenStreetMap Nominatim
 * --------------------------------------------------------------------------
 * Converts street addresses to latitude/longitude coordinates
 * Primary: US Census Geocoder (free, unlimited, accurate for US addresses)
 * Fallback: OpenStreetMap Nominatim (for addresses Census can't find)
 * Usage: npm run geocode
 */

import dotenv from 'dotenv';
import pg from 'pg';
import https from 'https';

// Load environment variables
dotenv.config();

// Nominatim API endpoint
const NOMINATIM_URL = 'nominatim.openstreetmap.org';

// US Census Geocoder API endpoint
const CENSUS_URL = 'geocoding.geo.census.gov';

// Delay between requests (1 second for Nominatim usage policy)
const DELAY_MS = 1000;

/**
 * Clean and preprocess address components
 */
function cleanAddress(address) {
  let street = address.street;
  let street2 = address.street2;

  // If street starts with P.O. Box or C/O, use street2 instead
  if (street && (
    street.match(/^P\.?O\.?\s*Box/i) ||
    street.match(/^C\/O\s+/i) ||
    street.match(/^Attn:/i)
  )) {
    if (street2) {
      // Use street2 as the main street, clear street2
      street = street2;
      street2 = null;
    } else {
      // Can't geocode P.O. Box without physical address
      return null;
    }
  }

  // Clean c/o from street if it's there
  if (street) {
    street = street.replace(/^c\/o\s+[^,]+,?\s*/i, '').trim();
    street = street.replace(/^Attn:\s+[^,]+,?\s*/i, '').trim();
  }

  // Clean c/o from street2 if it's there
  if (street2) {
    street2 = street2.replace(/^c\/o\s+[^,]+,?\s*/i, '').trim();
    street2 = street2.replace(/^Attn:\s+[^,]+,?\s*/i, '').trim();
    if (!street2) street2 = null;
  }

  return {
    street: street,
    street2: street2,
    city: address.city,
    state: address.state,
    postal_code: address.postal_code,
    country: address.country
  };
}

/**
 * Query US Census Geocoder API
 */
async function geocodeCensus(addressString) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      address: addressString,
      benchmark: 'Public_AR_Current',
      format: 'json'
    });

    const options = {
      hostname: CENSUS_URL,
      path: `/geocoder/locations/onelineaddress?${params.toString()}`,
      method: 'GET',
      headers: {
        'User-Agent': 'OceanSprayGrowerDatabase/1.0'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.result && response.result.addressMatches && response.result.addressMatches.length > 0) {
            const match = response.result.addressMatches[0];
            resolve({
              latitude: parseFloat(match.coordinates.y),
              longitude: parseFloat(match.coordinates.x),
              display_name: match.matchedAddress,
              source: 'US Census'
            });
          } else {
            resolve(null); // No results found
          }
        } catch (error) {
          reject(new Error(`Failed to parse Census response: ${error.message}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Census API request failed: ${error.message}`));
    });

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Census API request timeout'));
    });

    req.end();
  });
}

/**
 * Query Nominatim API to geocode an address (fallback)
 */
async function geocodeNominatim(addressString) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      q: addressString,
      format: 'json',
      limit: 1,
      addressdetails: 1,
      countrycodes: 'us'
    });

    const options = {
      hostname: NOMINATIM_URL,
      path: `/search?${params.toString()}`,
      method: 'GET',
      headers: {
        'User-Agent': 'OceanSprayGrowerDatabase/1.0'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const results = JSON.parse(data);
          if (results && results.length > 0) {
            const result = results[0];
            resolve({
              latitude: parseFloat(result.lat),
              longitude: parseFloat(result.lon),
              display_name: result.display_name,
              source: 'Nominatim'
            });
          } else {
            resolve(null); // No results found
          }
        } catch (error) {
          reject(new Error(`Failed to parse Nominatim response: ${error.message}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Nominatim API request failed: ${error.message}`));
    });

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Nominatim API request timeout'));
    });

    req.end();
  });
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Build full address string from address components
 */
function buildAddressString(address) {
  const parts = [];

  if (address.street) parts.push(address.street);
  if (address.city) parts.push(address.city);
  if (address.state) parts.push(address.state);
  if (address.postal_code) parts.push(address.postal_code);

  return parts.join(', ');
}

/**
 * Try to geocode an address with multiple strategies
 */
async function geocodeAddress(address) {
  // Strategy 1: Clean address and try US Census Geocoder
  const cleaned = cleanAddress(address);
  if (!cleaned) {
    return { error: 'P.O. Box only - no physical address' };
  }

  const addressString = buildAddressString(cleaned);

  try {
    const coords = await geocodeCensus(addressString);
    if (coords) {
      return coords;
    }
  } catch (error) {
    console.log(`      Census API error: ${error.message}`);
  }

  // Strategy 2: Try Nominatim (with delay for rate limiting)
  await sleep(DELAY_MS);
  try {
    const coords = await geocodeNominatim(addressString);
    if (coords) {
      return coords;
    }
  } catch (error) {
    console.log(`      Nominatim error: ${error.message}`);
  }

  // Strategy 3: Try city-level geocoding (approximate location)
  if (cleaned.city && cleaned.state) {
    const cityString = `${cleaned.city}, ${cleaned.state}`;
    await sleep(DELAY_MS);
    try {
      const coords = await geocodeCensus(cityString);
      if (coords) {
        coords.approximate = true;
        coords.source = 'US Census (city-level)';
        return coords;
      }
    } catch (error) {
      // Silently fail
    }
  }

  return null;
}

async function geocodeAllAddresses() {
  console.log('🌍 Starting Address Geocoding (US Census + Nominatim)...\n');

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

    // Get all addresses that don't have coordinates yet
    const query = `
      SELECT id, farm_id, street, street2, city, state, postal_code, country
      FROM farm_addresses
      WHERE latitude IS NULL OR longitude IS NULL
      ORDER BY id
    `;

    const result = await client.query(query);
    const addresses = result.rows;

    console.log(`📍 Found ${addresses.length} addresses to geocode\n`);

    if (addresses.length === 0) {
      console.log('✅ All addresses already have coordinates!\n');
      return;
    }

    let successCount = 0;
    let approximateCount = 0;
    let failCount = 0;
    const failed = [];
    const stats = { census: 0, nominatim: 0, cityLevel: 0 };

    console.log('🔄 Starting geocoding...\n');
    console.log('Progress:');
    console.log('-'.repeat(70));

    for (let i = 0; i < addresses.length; i++) {
      const address = addresses[i];
      const progress = `[${i + 1}/${addresses.length}]`;
      const displayAddr = `${address.city}, ${address.state}`;

      try {
        const result = await geocodeAddress(address);

        if (result && !result.error) {
          // Update database with coordinates
          await client.query(
            `UPDATE farm_addresses
             SET latitude = $1, longitude = $2, updated_at = CURRENT_TIMESTAMP
             WHERE id = $3`,
            [result.latitude, result.longitude, address.id]
          );

          const sourceIcon = result.source === 'US Census' ? '🎯' :
                           result.source === 'Nominatim' ? '🗺️' : '📍';
          const approxMarker = result.approximate ? ' (approximate)' : '';

          console.log(`${progress} ${sourceIcon} ${displayAddr}${approxMarker}`);
          console.log(`          → ${result.latitude}, ${result.longitude} [${result.source}]`);

          if (result.approximate) {
            approximateCount++;
          }
          if (result.source === 'US Census') stats.census++;
          if (result.source === 'Nominatim') stats.nominatim++;
          if (result.source.includes('city-level')) stats.cityLevel++;

          successCount++;
        } else {
          const reason = result?.error || 'No results from any geocoder';
          console.log(`${progress} ❌ ${displayAddr} - ${reason}`);
          failCount++;
          failed.push({
            id: address.id,
            address: buildAddressString(address),
            street: address.street,
            reason: reason
          });
        }

      } catch (error) {
        console.log(`${progress} ❌ ${displayAddr} - Error: ${error.message}`);
        failCount++;
        failed.push({
          id: address.id,
          address: buildAddressString(address),
          street: address.street,
          reason: error.message
        });
      }
    }

    console.log('-'.repeat(70));
    console.log('\n📊 GEOCODING SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total Addresses: ${addresses.length}`);
    console.log(`✅ Successfully Geocoded: ${successCount} (${((successCount/addresses.length)*100).toFixed(1)}%)`);
    console.log(`   - US Census Geocoder: ${stats.census}`);
    console.log(`   - OpenStreetMap Nominatim: ${stats.nominatim}`);
    console.log(`   - City-level (approximate): ${stats.cityLevel}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log('='.repeat(70));

    if (failed.length > 0) {
      console.log('\n⚠️  Failed Addresses:');
      failed.forEach(f => {
        console.log(`   ID ${f.id}: ${f.address}`);
        console.log(`   Original street: ${f.street}`);
        console.log(`   Reason: ${f.reason}\n`);
      });
    }

    // Show sample of geocoded addresses
    if (successCount > 0) {
      const sampleQuery = `
        SELECT id, city, state, latitude, longitude
        FROM farm_addresses
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        ORDER BY updated_at DESC
        LIMIT 10
      `;
      const sampleResult = await client.query(sampleQuery);
      console.log('\n📍 Sample of geocoded addresses (last 10):');
      console.table(sampleResult.rows);
    }

    await client.end();
    console.log('✅ Geocoding complete!\n');

  } catch (error) {
    console.error('❌ Error during geocoding:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
  }
}

geocodeAllAddresses();
