#!/usr/bin/env node
/**
 * Start a small local DAI Miner Network simulation
 * 
 * Spins up 3 miners and injects jobs.
 * Useful for exercising the local job queue.
 */

import { DAIMinerNode } from '../src/miner-node.js';
import { JobQueue } from '../src/jobs/job-queue.js';

console.log('\nStarting Local DAI Miner Network Simulation\n');

const jobQueue = new JobQueue();

const miners = [
  new DAIMinerNode({ wallet: 'miner-a', computeEnabled: true }),
  new DAIMinerNode({ wallet: 'miner-b', computeEnabled: true }),
  new DAIMinerNode({ wallet: 'miner-c', computeEnabled: true }),
];

for (const m of miners) {
  m.jobQueue = jobQueue; // share the queue for demo
  m.start().then(() => {
    console.log(`  ✓ ${m.config.wallet} online`);
  });
}

// Simulate incoming jobs with different origins
setTimeout(() => {
  console.log('\n📨 New job from Georgia user...');
  jobQueue.addJob({
    id: 'job-georgia-1',
    type: 'verdict',
    payload: { address: 'bc1qgeorgiauser' },
    fee: 22000000,
    originCountry: 'GE'
  });
}, 3000);

setTimeout(() => {
  console.log('\n📨 New job from Singapore user...');
  jobQueue.addJob({
    id: 'job-singapore-1',
    type: 'verdict',
    payload: { address: 'bc1qsingaporeuser' },
    fee: 18000000,
    originCountry: 'SG'
  });
}, 8000);

setTimeout(() => {
  console.log('\n✅ Simulation running. Press Ctrl+C to stop.\n');
}, 12000);

process.stdin.resume();
