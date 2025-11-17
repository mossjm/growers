#!/usr/bin/env node
/**
 * Database Setup Script
 * ---------------------
 * Drops and recreates the growers database, then runs schema.sql
 * Usage: npm run sql
 */

import fs from 'fs';
import dotenv from 'dotenv';
import pg from 'pg';

// Load environment variables
dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
};

async function setupDatabase() {
  console.log('🔧 Starting database setup...\n');

  // Connect to default postgres database (not growers)
  const postgresClient = new pg.Client({
    ...dbConfig,
    database: 'postgres',
  });

  try {
    await postgresClient.connect();
    console.log('✅ Connected to PostgreSQL server\n');

    // Terminate existing connections to growers database
    console.log('🔌 Terminating existing connections to growers database...');
    await postgresClient.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = 'growers' AND pid <> pg_backend_pid()
    `);

    // Drop database if exists
    console.log('🗑️  Dropping growers database if it exists...');
    await postgresClient.query('DROP DATABASE IF EXISTS growers');
    console.log('✅ Database dropped (if it existed)\n');

    // Create database
    console.log('🏗️  Creating growers database...');
    await postgresClient.query(`
      CREATE DATABASE growers
        ENCODING = 'UTF8'
        LC_COLLATE = 'en_US.UTF-8'
        LC_CTYPE = 'en_US.UTF-8'
        TEMPLATE = template0
    `);
    console.log('✅ Database created\n');

    await postgresClient.end();

    // Now connect to growers database to run schema
    console.log('📋 Running schema.sql...');
    const growersClient = new pg.Client({
      ...dbConfig,
      database: 'growers',
    });

    await growersClient.connect();

    // Read and execute schema.sql
    const schemaSQL = fs.readFileSync('./src/sql/schema.sql', 'utf8');
    await growersClient.query(schemaSQL);

    console.log('✅ Schema created successfully\n');

    // Verify tables were created
    const result = await growersClient.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    console.log('📊 Created tables:');
    result.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });

    // Verify views were created
    const viewsResult = await growersClient.query(`
      SELECT table_name
      FROM information_schema.views
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    if (viewsResult.rows.length > 0) {
      console.log('\n📊 Created views:');
      viewsResult.rows.forEach(row => {
        console.log(`   - ${row.table_name}`);
      });
    }

    await growersClient.end();

    console.log('\n🎉 Database setup complete!');
    console.log('   You can now run: npm start\n');

  } catch (error) {
    console.error('❌ Error during database setup:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
  }
}

setupDatabase();
