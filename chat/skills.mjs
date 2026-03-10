/**
 * Skill definitions and processing.
 *
 * Skills are predefined prompts/behaviors triggered by `/skill-name` syntax.
 * When a message starts with a skill name, the text is transformed to include
 * the skill's prompt.
 *
 * Special skills like /plan can also set CLI flags.
 */

/**
 * Available skills with their trigger conditions and prompts.
 */
export const SKILLS = {
  plan: {
    description: 'Start in Plan Mode - discuss and refine requirements before implementation.',
    prompt: null, // No prompt injection, just enables --permission-mode plan
    isPlanMode: true,
  },
  simplify: {
    description: 'Review changed code for reuse, quality, and efficiency, then fix any issues found.',
    prompt: `Review the recent code changes for:
1. Code reuse - identify duplicated logic that could be abstracted
2. Code quality - check for clarity, maintainability, and best practices
3. Efficiency - look for performance improvements

After reviewing, fix any issues found. Focus on practical improvements, not theoretical ones.`,
  },
  'claude-api': {
    description: 'Build apps with the Claude API or Anthropic SDK.',
    triggers: ['anthropic', '@anthropic-ai/sdk', 'claude_agent_sdk'],
    prompt: `Help build this application using Claude API / Anthropic SDK. Provide clear, working code examples and explain key concepts. Focus on:
1. Proper API usage patterns
2. Error handling
3. Best practices for Claude integration`,
  },
};

/**
 * Parse a message to detect skill syntax.
 *
 * @param {string} text - The user's message text
 * @returns {{ skill: string|null, args: string, text: string, planMode: boolean }}
 *   - skill: the skill name if detected, null otherwise
 *   - args: arguments passed after skill name
 *   - text: the transformed text with skill prompt injected
 *   - planMode: true if /plan was detected
 */
export function parseSkill(text) {
  // Match /skill-name or /skill-name followed by arguments
  const match = text.match(/^\/(\S+)(?:\s+(.*))?$/s);

  if (!match) {
    return { skill: null, args: '', text, planMode: false };
  }

  const skillName = match[1];
  const args = match[2] || '';

  const skill = SKILLS[skillName];
  if (!skill) {
    // Unknown skill - treat as regular text
    return { skill: null, args: '', text, planMode: false };
  }

  // Handle /plan specially - enables plan mode without prompt injection
  if (skill.isPlanMode) {
    return {
      skill: skillName,
      args,
      text: args || 'Help me plan this task. Let\'s discuss the requirements and approach before implementing.',
      planMode: true,
    };
  }

  // Transform the text to include skill prompt
  const transformedText = args
    ? `${skill.prompt}\n\n---\n\n${args}`
    : skill.prompt;

  return {
    skill: skillName,
    args,
    text: transformedText,
    planMode: false,
  };
}

/**
 * Get list of available skills for UI display.
 */
export function getAvailableSkills() {
  return Object.entries(SKILLS).map(([name, def]) => ({
    name,
    description: def.description,
  }));
}