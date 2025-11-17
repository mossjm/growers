#!/usr/bin/env node
/**
 * Help Command - Lists all available npm scripts
 */

console.log('\n📚 Ocean Spray Grower Database - Available Commands\n');
console.log('='.repeat(75));

const commands = [
  {
    command: 'npm start',
    description: 'Fetch contract data from Ocean Spray API and store in database',
    details: 'Fetches all contracts from GrowerList2024.json and stores beds/shapes'
  },
  {
    command: 'npm run sql',
    description: 'Setup/reset database schema',
    details: 'Drops and recreates database, runs schema.sql'
  },
  {
    command: 'npm run update-farms',
    description: 'Update farm names from GrowerList2024.json',
    details: 'Matches contract numbers to farm names and updates database'
  },
  {
    command: 'npm run summary',
    description: 'Generate contract summary report',
    details: 'Creates terminal table and CSV with farms, contracts, acres, addresses'
  },
  {
    command: 'npm run geocode',
    description: 'Geocode all farm addresses to lat/long coordinates',
    details: 'Uses US Census Geocoder + Nominatim fallback (70-80% success rate)'
  },
  {
    command: 'npm run export-geojson',
    description: 'Export farm locations to GeoJSON for QGIS',
    details: 'Creates output/farms.geojson with farm points'
  },
  {
    command: 'npm run export-beds',
    description: 'Export all farm bed polygons to single GeoJSON file',
    details: 'Creates output/beds_all_farms.geojson with all bed shapes'
  },
  {
    command: 'npm run export-beds-by-farm',
    description: 'Export bed polygons as separate files per farm',
    details: 'Creates output/farms/{farm_name}.geojson for each farm'
  },
  {
    command: 'npm run help',
    description: 'Show this help message',
    details: 'Lists all available commands'
  }
];

commands.forEach((cmd, index) => {
  console.log(`\n${index + 1}. ${cmd.command}`);
  console.log(`   ${cmd.description}`);
  console.log(`   → ${cmd.details}`);
});

console.log('\n' + '='.repeat(75));

console.log('\n💡 TYPICAL WORKFLOW:\n');
console.log('1. npm run sql              # Setup database');
console.log('2. npm start                # Fetch contract data');
console.log('3. npm run update-farms     # Add farm names');
console.log('4. npm run geocode          # Geocode addresses (one-time)');
console.log('5. npm run export-geojson   # Export farm points');
console.log('6. npm run export-beds      # Export bed polygons');
console.log('7. npm run summary          # Generate summary report\n');

console.log('📖 For more information, see docs/CLAUDE.md or README.md\n');
console.log('📂 Project Structure:');
console.log('   src/commands/  - CLI commands');
console.log('   src/export/    - GeoJSON export utilities');
console.log('   src/database/  - Database setup scripts');
console.log('   src/sql/       - SQL schema files');
console.log('   input/         - Source data files');
console.log('   output/        - Generated reports & GeoJSON files');
console.log('   data/          - Downloaded contract data');
console.log('   logs/          - Application logs\n');
