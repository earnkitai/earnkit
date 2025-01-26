import express from 'express';
import * as logsController from '../../controllers/web/agentLogs/logs.controller';

const router = express.Router();

// Logs routes (no JWT required as they're from external sources)
router.post('/logs/interaction', logsController.createInteractionLog);
router.post('/logs/agent-response', logsController.createAgentResponse);
router.get('/logs/agent/:agentId', logsController.getAgentLogs);
router.get('/logs/agent/:agentId/responses', logsController.getAgentResponses);
router.get(
  '/logs/agent/:agentId/interactions',
  logsController.getAgentInteractionsWithResponses,
);

export default router;
