const { randomUUID } = require('node:crypto');

const method = 'Propose two distinct approaches to the current decision. Probe each against the same observations, identifying a concrete next action, supporting evidence and a limitation. Compose one next step or identify what evidence is missing. Carry out actions only through the normal agent and its existing permissions.';
const when = 'Use Harness² at any stage when a choice matters, including before the first action or when the user requests it. Revisit the comparison when the evidence or question changes.';
const nativeInstructions = when + ' Call harness2_compare with the decision and relevant observations.';
const mcpInstructions = when + ' Use harness2_propose, harness2_probe for each approach, then harness2_compose. ' + method;
const inlineInstructions = when + ' Apply the following workflow with your current model. ' + method;
const str = description => ({type:'string', description});
const tool = (name, description, properties, required = Object.keys(properties)) => ({
  name, description, inputSchema:{type:'object',properties,required,additionalProperties:false},
});
const goal = str('Decision or problem to solve within the user’s task.');
const evidence = str('Relevant facts observed so far. An empty string is valid before the first action.');
const id = str('Comparison ID returned by harness2_propose.');
const nativeTool = tool('harness2_compare','Compare two strategies with the current model and return a proposed next step. Available before, during or after tool use.', {goal,evidence}, ['goal']);
const tools = [
  tool('harness2_propose','Start a Harness² comparison at any point. Supply two distinct candidate strategies and the same starting evidence for both.', {goal,evidence,first:str('First approach.'),second:str('Different second approach.')}),
  tool('harness2_probe','Assess one proposed approach on the recorded evidence, without performing the action.', {id,option:{type:'integer',minimum:1,maximum:2},assessment:str('Concrete next action, supporting evidence and one limitation.')}),
  tool('harness2_compose','Conclude after both probes. Select 1 or 2, or 0 when neither approach is supported.', {id,choice:{type:'integer',minimum:0,maximum:2},conclusion:str('One evidence-supported next step or the remaining blocker.')}),
];
function field(value, max, optional = false) {
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max) throw Error('Expected bounded text for this comparison.');
  return value.trim();
}
function readDecision(args) {
  return {goal:field(args.goal, 1800), evidence:field(args.evidence ?? '', 4000, true)};
}

// A comparison belongs to one agent run. Each probe uses the calling agent's
// model and the evidence captured at proposal time. The host never executes a plan.
function createComparisons() {
  const entries = new Map();
  return (name, args) => {
    if (name === 'harness2_propose') {
      const decision = readDecision(args);
      const options = [field(args.first,700),field(args.second,700)];
      if (options[0] === options[1]) throw Error('Propose two different approaches.');
      // Keep abandoned comparisons bounded in terminals that stay open for days.
      if (entries.size >= 32) entries.delete(entries.keys().next().value);
      const id = randomUUID();
      entries.set(id,{...decision,options,assessments:[null,null]});
      return {id,...decision,options,next:'Call harness2_probe for each option using this evidence.'};
    }
    const entry = entries.get(args.id);
    if (!entry) throw Error('Start a comparison in this session with harness2_propose.');
    if (name === 'harness2_probe') {
      if (![1,2].includes(args.option)) throw Error('Choose option 1 or 2.');
      entry.assessments[args.option-1] = field(args.assessment,1200);
      const remaining = entry.assessments.indexOf(null);
      return {id:args.id,...entry,next:remaining < 0 ? 'Compare both assessments and call harness2_compose.' : 'Probe option ' + (remaining+1) + '.'};
    }
    if (name !== 'harness2_compose') throw Error('Unknown Harness² operation.');
    if (entry.assessments.includes(null)) throw Error('Probe both options before composing.');
    if (![0,1,2].includes(args.choice)) throw Error('Choose 1, 2 or 0 for a blocker.');
    const conclusion = field(args.conclusion,1000);
    entries.delete(args.id);
    return {goal:entry.goal, strategy:entry.options[args.choice-1] ?? null, conclusion};
  };
}
module.exports = {when, nativeInstructions, mcpInstructions, inlineInstructions, nativeTool, tools, createComparisons, readDecision};
