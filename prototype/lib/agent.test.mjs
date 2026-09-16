import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentRequestError,
  buildAgentMessages,
  detectSafetyMode,
  parseAgentRequest,
} from './agent.mjs';

const validPayload = {
  role: 'angel',
  decisionTitle: '要不要接这个项目？',
  turns: [
    {
      userMessage: '机会很好，但我最近很累。',
      responses: [
        {
          role: 'devil',
          content: '先别忽略你的精力成本。',
          status: 'complete',
        },
      ],
    },
  ],
};

test('parseAgentRequest validates and preserves the shared conversation', () => {
  const request = parseAgentRequest(validPayload);

  assert.equal(request.role, 'angel');
  assert.equal(request.turns[0].responses[0].role, 'devil');
  assert.equal(request.turns[0].responses[0].content, '先别忽略你的精力成本。');
});

test('parseAgentRequest accepts the empty in-flight reply placeholder', () => {
  const request = parseAgentRequest({
    ...validPayload,
    turns: [
      {
        userMessage: '这一轮请天使先说。',
        responses: [
          {
            role: 'angel',
            content: '',
            status: 'streaming',
          },
        ],
      },
    ],
  });

  assert.equal(request.turns[0].responses[0].status, 'streaming');
  assert.equal(request.turns[0].responses[0].content, '');
  assert.doesNotMatch(
    buildAgentMessages(request, 'standard')[1].content,
    /"speaker": "天使 \/ YES"/,
  );
});

test('parseAgentRequest rejects invalid roles and oversized user messages', () => {
  assert.throws(
    () => parseAgentRequest({ ...validPayload, role: 'judge' }),
    AgentRequestError,
  );
  assert.throws(
    () =>
      parseAgentRequest({
        ...validPayload,
        turns: [{ userMessage: 'x'.repeat(2001), responses: [] }],
      }),
    AgentRequestError,
  );
});

test('buildAgentMessages gives the angel a fixed stance and the complete context', () => {
  const request = parseAgentRequest({
    ...validPayload,
    turns: [
      ...validPayload.turns,
      {
        userMessage: '如果只试两周呢？',
        responses: [
          {
            role: 'angel',
            content: '那就先设定退出条件。',
            status: 'complete',
          },
          {
            role: 'devil',
            content: '这条失败回复不应进入上下文。',
            status: 'error',
          },
        ],
      },
    ],
  });
  const messages = buildAgentMessages(request, 'standard');

  assert.match(messages[0].content, /YES/);
  assert.match(messages[0].content, /不能替用户作出最终决定/);
  assert.match(messages[1].content, /机会很好，但我最近很累/);
  assert.match(messages[1].content, /先别忽略你的精力成本/);
  assert.match(messages[1].content, /如果只试两周呢/);
  assert.doesNotMatch(messages[1].content, /这条失败回复/);
});

test('buildAgentMessages keeps the devil on the NO side', () => {
  const request = parseAgentRequest({ ...validPayload, role: 'devil' });
  const messages = buildAgentMessages(request, 'standard');

  assert.match(messages[0].content, /NO/);
  assert.match(messages[0].content, /不做、暂停或延后/);
});

test('detectSafetyMode pauses game persuasion for imminent harm', () => {
  assert.equal(detectSafetyMode('我现在想死，已经站在楼顶了'), 'crisis');
  assert.equal(detectSafetyMode('我要不要起诉公司？'), 'high_stakes');
  assert.equal(detectSafetyMode('要不要换一个新工作？'), 'standard');
});
