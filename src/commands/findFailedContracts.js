#!/usr/bin/env node
/**
 * Find contracts that failed to insert (had 0 beds)
 */

import fs from 'fs';

// Read status.txt and extract contracts with 0 beds
const statusContent = fs.readFileSync('./logs/status.txt', 'utf8');
const lines = statusContent.split('\n');

const failedContracts = [];
for (const line of lines) {
  if (line.includes('Fetched 0 bed record(s)')) {
    // Extract contract number from line like: "✅ API SUCCESS: 0781502 - Fetched 0 bed..."
    const match = line.match(/API SUCCESS: (\d+)/);
    if (match) {
      failedContracts.push(match[1]);
    }
  }
}

// Read GrowerList2024.json
const growerList = JSON.parse(fs.readFileSync('./input/GrowerList2024.json', 'utf8'));

// Create a map of contract number to bpName
// Note: extBpId is the contract number field in the JSON
const contractMap = new Map();
for (const grower of growerList) {
  if (grower.extBpId && grower.bpName) {
    contractMap.set(grower.extBpId, grower.bpName);
  }
}

// Match and display results
console.log('Contracts that failed to insert (0 beds):\n');
console.log('Contract Number | Farm Name');
console.log('-'.repeat(60));

const results = [];
for (const contractNum of failedContracts) {
  const farmName = contractMap.get(contractNum) || 'NOT FOUND IN GROWER LIST';
  results.push({ contractNum, farmName });
  console.log(`${contractNum.padEnd(15)} | ${farmName}`);
}

console.log('-'.repeat(60));
console.log(`\nTotal failed contracts: ${failedContracts.length}`);

// Save to CSV
const csvContent = 'contract_number,farm_name\n' +
  results.map(r => `${r.contractNum},"${r.farmName}"`).join('\n');

fs.writeFileSync('./output/failed_contracts.csv', csvContent, 'utf8');
console.log('\nSaved to: output/failed_contracts.csv');
