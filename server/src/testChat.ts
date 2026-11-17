import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { connectDB, disconnectDB } from './config/db';
import { processChat, clearChatSession } from './ai/chatService';

async function testChatFlow() {
  console.log('=== Testing Chat Flow with Gemini & Decision Engine ===\n');
  await connectDB();

  const sessionId = `test-session-${Date.now()}`;

  try {
    // Turn 1: User specifies a request
    console.log('User: "I need 20 deep groove ball bearings 6205 for Pune plant PUN1 by 2026-03-15"');
    const res1 = await processChat(sessionId, 'I need 20 deep groove ball bearings 6205 for Pune plant PUN1 by 2026-03-15');
    console.log('Assistant Action:', res1.action);
    console.log('Assistant Reply:\n', res1.reply);
    console.log('\n----------------------------------------\n');

    if (res1.action === 'confirm_pr') {
      console.log('User: "yes"');
      const res2 = await processChat(sessionId, 'yes');
      console.log('Assistant Action:', res2.action);
      console.log('Assistant Reply:\n', res2.reply);
      console.log('Decision Route:', res2.decisionResult?.route);
      console.log('Decision Supplier:', res2.decisionResult?.supplier_id);
      console.log('Total Value:', res2.decisionResult?.group_value_inr);
    } else {
      console.log('Did not reach confirm_pr, action was:', res1.action);
    }
  } catch (error: any) {
    console.error('Chat test failed:', error);
  } finally {
    clearChatSession(sessionId);
    await disconnectDB();
    console.log('\n=== Chat Test Complete ===');
  }
}

testChatFlow();
