import { describe, it, expect, vi } from 'vitest';
import { DAIMinerNode } from '../src/miner-node.js';
import { skillsManager } from '../src/skills/manager.js';

/**
 * Regression: a task-cascade task for a context-only reference skill (the
 * eth_, sol_, bnb_mcp, euler_ packs — DEFAULT_ENABLED_SKILLS, "No live API
 * calls — answered directly from bundled reference docs") always failed with
 * "Skill <id> not found or has no run.js". skillsManager.runSkill only knows
 * how to execute a *coded* skill (a sandboxed run.js); a knowledge-only skill
 * has no code at all, by design. The single-skill chat route already branched
 * on that distinction (knowledgeSkillSystemPrompt + a plain LLM call); the
 * cascade executor had no equivalent, so every cascade that picked up one of
 * these dozens of skills reported that specialist as failed, every time.
 */
describe('_runSkillForCascade', () => {
  it('answers a context-only (coded-less) skill from its reference material instead of throwing', async () => {
    skillsManager.addPrivateSkill(
      { id: 'test_knowledge_skill' },
      null, // no code — this is the defining trait of a reference-only skill
      'Reference doc: widgets cost 3 doubloons.',
    );

    const node = Object.create(DAIMinerNode.prototype);
    node.config = { model: 'qwen3-1.7b' };
    node._llmChat = vi.fn().mockResolvedValue('Widgets cost 3 doubloons, per the reference docs.');

    const result = await node._runSkillForCascade('test_knowledge_skill', { message: 'how much do widgets cost?' }, { model: 'qwen3-1.7b' });

    expect(result.output).toBe('Widgets cost 3 doubloons, per the reference docs.');
    expect(result.tokensUsed).toBeGreaterThan(0);
    // Answered via a plain chat call carrying the reference context — not the
    // sandboxed skill-runner worker, which would have thrown for this skill.
    expect(node._llmChat).toHaveBeenCalledTimes(1);
    const [messages] = node._llmChat.mock.calls[0];
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('widgets cost 3 doubloons');
    expect(messages[1]).toEqual({ role: 'user', content: 'how much do widgets cost?' });
  });

  it('still runs a coded skill through skillsManager.runSkill, unchanged', async () => {
    skillsManager.addPrivateSkill(
      { id: 'test_coded_skill' },
      'module.exports = async () => ({ ok: true });',
      null,
    );
    const runSkillSpy = vi.spyOn(skillsManager, 'runSkill').mockResolvedValue({ output: { ok: true }, tokensUsed: 10 });

    const node = Object.create(DAIMinerNode.prototype);
    node.config = { model: 'qwen3-1.7b' };
    node._llmChat = vi.fn();

    const result = await node._runSkillForCascade('test_coded_skill', { message: 'go' }, { model: 'qwen3-1.7b' });

    expect(result).toEqual({ output: { ok: true }, tokensUsed: 10 });
    expect(runSkillSpy).toHaveBeenCalledWith('test_coded_skill', { message: 'go' }, node.config);
    expect(node._llmChat).not.toHaveBeenCalled();
    runSkillSpy.mockRestore();
  });

  it('falls through to skillsManager.runSkill\'s own error for a truly unknown skill', async () => {
    const node = Object.create(DAIMinerNode.prototype);
    node.config = {};
    node._llmChat = vi.fn();
    await expect(node._runSkillForCascade('no_such_skill', {}, {})).rejects.toThrow(/not found|has no run\.js/);
  });
});
