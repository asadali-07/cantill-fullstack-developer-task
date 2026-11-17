import { Router, Request, Response } from 'express';
import { processChat, getChatHistory, clearChatSession } from '../ai/chatService';

const router = Router();

/**
 * POST /api/chat
 * Body: { sessionId: string, message: string }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) {
      return res.status(400).json({ error: 'sessionId and message are required' });
    }

    const result = await processChat(sessionId, message);
    return res.json(result);
  } catch (error: any) {
    console.error('[Chat API Error]:', error);
    return res.status(500).json({ error: error.message || 'Internal chat error' });
  }
});

/**
 * GET /api/chat/history/:sessionId
 */
router.get('/history/:sessionId', (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;
    const history = getChatHistory(sessionId);
    return res.json({ history });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to get chat history' });
  }
});

/**
 * DELETE /api/chat/:sessionId
 */
router.delete('/:sessionId', (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;
    clearChatSession(sessionId);
    return res.json({ success: true, message: 'Chat session cleared' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to clear session' });
  }
});

export default router;
