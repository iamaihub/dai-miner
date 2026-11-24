import { describe, expect, it } from 'vitest';
import { presentChatReply, presentProfile, requestedReplyFormat } from '../src/ai/chat-reply.js';
import { executeTaskCascade } from '../src/ai/task-cascade.js';

const weather = {
  place: 'Refill Now, Bangkok',
  latitude: 13.74,
  longitude: 100.58,
  generationtime_ms: 0.198,
  utc_offset_seconds: 25200,
  timezone: 'Asia/Bangkok',
  current_weather: { temperature: 31.4, windspeed: 7.2, weathercode: 1, time: '2026-11-22T15:00' },
  daily: {
    time: ['2026-11-22', '2026-11-23'],
    temperature_2m_max: [33, 32],
    temperature_2m_min: [25, 24],
    precipitation_sum: [0, 1.2],
    weathercode: [1, 61],
  },
};

const weatherJson = JSON.stringify(weather, null, 2);

describe('requestedReplyFormat', () => {
  it('stays prose when the user did not name a format', () => {
    expect(requestedReplyFormat("what's the weather in bangkok now?")).toBeNull();
    expect(requestedReplyFormat('what is json')).toBeNull();
  });

  it('notices an explicit format', () => {
    expect(requestedReplyFormat('give me the weather as json')).toBe('json');
    expect(requestedReplyFormat('export as csv')).toBe('csv');
    expect(requestedReplyFormat('yaml only')).toBe('yaml');
    expect(requestedReplyFormat('show this as a table')).toBe('table');
  });
});

describe('presentChatReply', () => {
  it('turns a weather payload into a sentence', () => {
    const text = presentChatReply("what's the weather in bangkok now?", weatherJson);
    expect(text).toMatch(/31\.4°C/);
    expect(text).toMatch(/mainly clear/);
    expect(text).toMatch(/Coming days/);
    expect(text).not.toMatch(/generationtime_ms/);
    expect(text.trim().startsWith('{')).toBe(false);
  });

  it('keeps JSON when the user asked for JSON', () => {
    expect(presentChatReply('as json please', weatherJson)).toBe(weatherJson.trim());
  });

  it('renders CSV and a table when those were asked for', () => {
    const rows = JSON.stringify([{ city: 'Bangkok', temp: 31 }, { city: 'Chiang Mai', temp: 28 }]);
    expect(presentChatReply('export as csv', rows)).toBe('city,temp\nBangkok,31\nChiang Mai,28');
    expect(presentChatReply('as a table', rows)).toMatch(/\| city \| temp \|/);
  });

  it('leaves a normal sentence alone', () => {
    expect(presentChatReply('hi', 'It is 31°C and clear.')).toBe('It is 31°C and clear.');
  });

  it('rewrites the cascade fallback fence', () => {
    const fenced = `**public-apis/weather**\n\`\`\`json\n${weatherJson}\n\`\`\``;
    const text = presentChatReply('weather in bangkok', fenced);
    expect(text).toMatch(/31\.4°C/);
    expect(text).not.toMatch(/```/);
  });

  it('rewrites a stored job profile', () => {
    const profile = presentProfile('weather', { computeOutput: weatherJson, model: 'qwen' });
    expect(profile.computeOutput).toMatch(/31\.4°C/);
    expect(profile.model).toBe('qwen');
  });
});

describe('task cascade fallback', () => {
  it('answers in prose when the aggregator model is down', async () => {
    const plan = {
      type: 'tasks',
      stages: [[{
        kind: 'mcp',
        id: 'public-apis/weather',
        tool: 'public_weather_forecast',
        argKeys: ['city'],
        arguments: { city: 'Bangkok' },
      }]],
    };
    const result = await executeTaskCascade(plan, {
      callMcp: async () => weatherJson,
      llm: async () => { throw new Error('model down'); },
    }, "what's the weather in bangkok now?");
    expect(result.reply).toMatch(/31\.4°C/);
    expect(result.reply).not.toMatch(/generationtime_ms/);
    expect(result.reply.trim().startsWith('{')).toBe(false);
  });
});
