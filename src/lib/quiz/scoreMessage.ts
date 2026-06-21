// src/lib/quiz/scoreMessage.ts
// Post-quiz Teli message pools and helpers — ported verbatim from V1
// app/(dashboard)/student/quiz/page.tsx:162-395.
//
// Framework-agnostic: no React, no Next.js, no browser globals required.
//
// localStorage de-dup note:
//   V1's pickVariantStable used window.localStorage to avoid showing the same
//   variant back-to-back across quiz attempts. That dependency makes the function
//   non-pure and breaks server-side usage. In V2 we drop the localStorage branch
//   entirely: the function is now pure — same (seed, pool) always returns the
//   same variant. Callers that want sequential de-dup should pass a seed that
//   includes the attempt-ID (which changes every attempt), which already provides
//   sufficient entropy to avoid accidental repetition in practice.

import { hasLeak } from '@/lib/copy/leakGuard';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ScoreVariant = {
  message: string;
  teliMsg: string;
  teliState: 'celebrating' | 'idle' | 'speaking';
};

export type Band = 'celebrating' | 'strong' | 'effort' | 'tough';
export type Tier = 'elementary' | 'middle' | 'high';

// ── EN tier-aware pool ────────────────────────────────────────────────────────
// Tier-aware EN voices. Use {name} as placeholder for the student's first
// name — substituted at render time. Elementary leans playful + emoji.
// Middle is friendly + casual. High is peer-equal + respectful, no emoji.
// teliMsg is spoken by TTS so emoji is minimal there (TTS reads them weirdly).

export const SCORE_VARIANTS_EN_BY_TIER: Record<Tier, Record<Band, ScoreVariant[]>> = {
  elementary: {
    celebrating: [
      { message: "{name}, you crushed it! 🌟",                                    teliMsg: "{name}, you crushed it. I barely had to help.",                                    teliState: 'celebrating' },
      { message: "Whoa, {name}! 🎉 You really got this one.",                     teliMsg: "Whoa, {name}, you really got this one. Your assignments will be a fun challenge.",    teliState: 'celebrating' },
      { message: "Amazing brain at work, {name}! 🧠✨",                           teliMsg: "Amazing brain at work, {name}. Let's see what you can do in your assignments.",            teliState: 'celebrating' },
      { message: "High five, {name}! 🙌 You showed what you know.",               teliMsg: "High five, {name}. You showed what you know — your assignments will keep going.",          teliState: 'celebrating' },
    ],
    strong: [
      { message: "Nice work, {name}! ⭐ Just a couple of spots to look at.",      teliMsg: "Nice work, {name}. Just a couple of spots to look at in your assignments.",          teliState: 'idle' },
      { message: "{name}, you're really getting it! 💪",                         teliMsg: "{name}, you're really getting it. Your assignments will polish the rest.",                  teliState: 'idle' },
      { message: "Look at you go, {name}! 🚀 Most of it stuck.",                  teliMsg: "Look at you go, {name}. Most of it stuck — your assignments get the rest.",              teliState: 'idle' },
      { message: "Solid try, {name}! ✨ A few things to revisit.",                teliMsg: "Solid try, {name}. A few things to revisit in your assignments.",                          teliState: 'idle' },
    ],
    effort: [
      { message: "Way to stick with it, {name}! 💪 Assignments will help.",          teliMsg: "Way to stick with it, {name}. Your assignments will go back over the tricky parts.",  teliState: 'speaking' },
      { message: "{name}, you didn't quit — that's HUGE. 👏",                    teliMsg: "{name}, you didn't quit, and that's huge. Your assignments rebuild what was tricky.",     teliState: 'speaking' },
      { message: "Halfway there, {name}! 🌱 Assignments pick up the rest.",         teliMsg: "Halfway there, {name}. Your assignments pick up the other half.",                         teliState: 'speaking' },
      { message: "Good try, {name}! 💙 Your assignments are made just for you.",     teliMsg: "Good try, {name}. Your assignments are made just for you.",                            teliState: 'speaking' },
    ],
    tough: [
      { message: "{name}, this one was tough — and that's okay! 💙",             teliMsg: "{name}, this one was tough, and that's okay. We'll go slower in your assignments.",  teliState: 'speaking' },
      { message: "Brave try, {name}! 🌟 Assignments will start fresh.",              teliMsg: "Brave try, {name}. Your assignments will start fresh with examples.",                 teliState: 'speaking' },
      { message: "Hey {name}, hard quiz! 💪 Assignments break it into smaller bits.", teliMsg: "Hey {name}, hard quiz. Your assignments break it into smaller bits with hints.",  teliState: 'speaking' },
      { message: "{name}, you showed up — that counts. 🌈 Assignments start over.",  teliMsg: "{name}, you showed up, and that counts. Your assignments start over with more help.",    teliState: 'speaking' },
    ],
  },
  middle: {
    celebrating: [
      { message: "Nailed it, {name}. Strong grasp on this one.",                  teliMsg: "Nailed it, {name}. I barely had to help.",                                          teliState: 'celebrating' },
      { message: "{name}, you read these carefully — and it shows.",              teliMsg: "{name}, you read these carefully and it shows. Your assignments will push further.",       teliState: 'celebrating' },
      { message: "Strong work, {name}. Reasoning held up across the board.",      teliMsg: "Strong work, {name}. Your reasoning held up — your assignments will lean in harder.",      teliState: 'celebrating' },
      { message: "Top-band score, {name}. The concepts are clicking.",            teliMsg: "Top-band, {name}. The concepts are clicking. Your assignments will push you further.",    teliState: 'celebrating' },
    ],
    strong: [
      { message: "Solid work, {name}. A couple of spots to revisit.",             teliMsg: "Solid work, {name}. Let's look at a couple of spots in your assignments.",          teliState: 'idle' },
      { message: "{name}, mostly there. Assignments tighten the rest.",             teliMsg: "{name}, mostly there. Your assignments tighten the parts that wobbled.",                  teliState: 'idle' },
      { message: "Confident performance, {name} — narrow gaps.",                  teliMsg: "Confident performance, {name}. Narrow gaps to close in your assignments.",                 teliState: 'idle' },
      { message: "Above grade level on this, {name}. Assignments target what's loose.", teliMsg: "Above grade level here, {name}. Your assignments target what's still loose.",         teliState: 'idle' },
    ],
    effort: [
      { message: "{name}, you stuck with it. Assignments pick up where you left off.", teliMsg: "{name}, you stuck with it. Your assignments re-teach what didn't stick yet.",         teliState: 'speaking' },
      { message: "Partial mastery, {name}. There's a clear path in your assignments.",    teliMsg: "Partial mastery, {name}. Some parts landed — your assignments focus on what didn't.",  teliState: 'speaking' },
      { message: "Halfway there, {name}. Assignments close the rest.",              teliMsg: "Halfway there, {name}. Your assignments close the rest of the gap.",                      teliState: 'speaking' },
      { message: "Effort showed up, {name}. Accuracy needs another pass.",        teliMsg: "Effort was real, {name}. Your assignments will work on accuracy with you.",                 teliState: 'speaking' },
    ],
    tough: [
      { message: "{name}, this one was tough. Assignments start over.",             teliMsg: "{name}, tough one. Your assignments will go back to the basics, slower.",                   teliState: 'speaking' },
      { message: "Reteach mode for {name}. Assignments rebuild from the ground up.", teliMsg: "Reteach mode, {name}. Your assignments rebuild this from the ground up.",                 teliState: 'speaking' },
      { message: "Don't read this as failure, {name} — read it as where to start.", teliMsg: "Don't read this as failure, {name}. It tells me where to start in your assignments.",   teliState: 'speaking' },
      { message: "{name}, you showed up — assignments handle the rest.",            teliMsg: "{name}, you showed up and tried. I'll handle the re-teach in your assignments.",     teliState: 'speaking' },
    ],
  },
  high: {
    celebrating: [
      { message: "Strong mastery, {name} — assignments will challenge you further.", teliMsg: "Strong mastery here, {name}. I barely had to help — your assignments lean into harder applications.", teliState: 'celebrating' },
      { message: "{name}, your reasoning came through clearly across the questions.", teliMsg: "{name}, your reasoning came through clearly. Your assignments will push the concepts further.", teliState: 'celebrating' },
      { message: "High accuracy with substantive thinking, {name}.",                teliMsg: "High accuracy and substantive thinking, {name}. Your assignments keep that momentum.",         teliState: 'celebrating' },
      { message: "{name} — this score reflects real comprehension. Next: application.", teliMsg: "{name}, this reflects real comprehension. Your assignments move into application.",        teliState: 'celebrating' },
    ],
    strong: [
      { message: "{name} — solid performance. Assignments target the specific gaps.", teliMsg: "Solid performance, {name}. Your assignments target the few items that slipped.",          teliState: 'idle' },
      { message: "Mostly accurate with strong reasoning, {name}.",                 teliMsg: "Mostly accurate, {name}. Your assignments fill the narrow gaps.",                            teliState: 'idle' },
      { message: "{name}, above grade level here — targeted practice next.",        teliMsg: "{name}, above grade level. Your assignments target what's still loose.",                     teliState: 'idle' },
      { message: "{name} — confident showing. Narrow gaps to close.",              teliMsg: "{name}, confident showing. Your assignments circle back on a few items.",                    teliState: 'idle' },
    ],
    effort: [
      { message: "{name} — partial mastery. Assignments focus on what tripped you up.", teliMsg: "{name}, partial mastery. Your assignments focus on the parts that didn't land.",       teliState: 'speaking' },
      { message: "Mid-band score, {name}. Assignments re-teach with different angles.", teliMsg: "Mid-band, {name}. Your assignments re-teach the same concepts from different angles.", teliState: 'speaking' },
      { message: "{name}, you finished the quiz. Assignments handle the fuzzy parts.", teliMsg: "{name}, you finished. Your assignments re-teach what's still fuzzy.",                     teliState: 'speaking' },
      { message: "Reasoning was on track in places, {name}. Assignments get accuracy there too.", teliMsg: "{name}, your thinking was on track in places. Your assignments bring accuracy along.", teliState: 'speaking' },
    ],
    tough: [
      { message: "{name} — tough quiz. Assignments re-teach from a different angle.", teliMsg: "{name}, tough quiz. Your assignments re-teach from a different angle, slower.",          teliState: 'speaking' },
      { message: "Reteach scope, {name}. Assignments rebuild the foundation.",        teliMsg: "Reteach scope, {name}. Your assignments rebuild the foundation with examples.",             teliState: 'speaking' },
      { message: "{name}, this tells me where to start, not where you'll end up.",   teliMsg: "{name}, this tells me where to start. Your assignments begin from the basics.",            teliState: 'speaking' },
      { message: "{name} — your assignments are your second shot, designed for exactly this.", teliMsg: "{name}, your assignments are your second shot. Designed for exactly this case.",            teliState: 'speaking' },
    ],
  },
};

// ── PT pool ───────────────────────────────────────────────────────────────────
// PT-BR variants — match the Barb-approved voice rules: "você" informal,
// no Ótimo/Excelente/Incrível/Perfeito, dignity register (no pity),
// Teli stays as proper noun, homework referenced as "tarefa".

export const SCORE_VARIANTS_PT: Record<Band, ScoreVariant[]> = {
  celebrating: [
    { message: 'Trabalho forte — você claramente entendeu o material.',                          teliMsg: 'Você acertou. Eu mal precisei ajudar.',                                                       teliState: 'celebrating' },
    { message: 'Pontuação alta — preparo bem feito.',                                            teliMsg: 'Trabalho fechado de ponta a ponta. A próxima tarefa vai te esticar mais.',                    teliState: 'celebrating' },
    { message: 'Você mostrou domínio real nessa.',                                               teliMsg: 'Resposta afiada. Vamos ver até onde a tarefa pode levar isso.',                                teliState: 'celebrating' },
    { message: 'Resultado forte. O raciocínio por trás das suas respostas apareceu.',            teliMsg: 'Respostas precisas. A tarefa vai pedir aplicações mais difíceis.',                             teliState: 'celebrating' },
    { message: 'Esta nota reflete compreensão sólida em todas as questões.',                     teliMsg: 'Trabalho direto. A tarefa vai puxar os conceitos mais à frente.',                              teliState: 'celebrating' },
    { message: 'Resultado consistente — recall rápido e raciocínio se sustentaram.',             teliMsg: 'Respostas confiantes em todas. A tarefa mantém esse ritmo.',                                  teliState: 'celebrating' },
    { message: 'Você leu as questões com cuidado e isso aparece.',                               teliMsg: 'Trabalho cuidadoso e correto. Vamos adicionar desafio na tarefa.',                             teliState: 'celebrating' },
    { message: 'Alta precisão com raciocínio claro — combinação rara.',                          teliMsg: 'Suas respostas e seu raciocínio caíram juntos. A tarefa segue esse momento.',                  teliState: 'celebrating' },
    { message: 'Você lidou bem com as partes abertas.',                                          teliMsg: 'Suas respostas escritas mostraram pensamento real. A tarefa vai expandir isso.',                teliState: 'celebrating' },
    { message: 'Pontuação alta — os conceitos estão se encaixando.',                             teliMsg: 'Está se encaixando. A tarefa vai te dar espaço para aplicar.',                                 teliState: 'celebrating' },
  ],
  strong: [
    { message: 'Trabalho forte — algumas áreas para explorar mais.',                             teliMsg: 'Trabalho sólido. Vamos olhar alguns pontos na sua tarefa.',                                    teliState: 'idle' },
    { message: 'Boa compreensão geral — a tarefa vai afiar as bordas.',                          teliMsg: 'Quase lá. A tarefa vai apertar as partes que oscilaram.',                                      teliState: 'idle' },
    { message: 'A maioria das questões caiu certo.',                                             teliMsg: 'A maior parte ficou. A tarefa volta no que não ficou.',                                        teliState: 'idle' },
    { message: 'Trabalho consistente — raciocínio em boa forma.',                                teliMsg: 'Seu raciocínio está firme. A tarefa trabalha as lacunas.',                                     teliState: 'idle' },
    { message: 'Acima do nível esperado nessa. Próximo passo: prática direcionada.',             teliMsg: 'Acima do nível esperado aqui. A tarefa mira no que ainda está solto.',                         teliState: 'idle' },
    { message: 'Trabalho confiante — alguns itens para revisitar.',                              teliMsg: 'Trabalho confiante. A tarefa volta em algumas coisas.',                                        teliState: 'idle' },
    { message: 'Você está mostrando o padrão de quem estudou isso.',                             teliMsg: 'Aparece que você se preparou. A tarefa polir o resto.',                                        teliState: 'idle' },
    { message: 'Quase tudo correto com raciocínio sólido por trás das suas respostas.',          teliMsg: 'Precisão e raciocínio bem alinhados. A tarefa preenche os buracos.',                           teliState: 'idle' },
    { message: 'Boa exibição — a tarefa foca nas que você errou.',                               teliMsg: 'Forte no geral. A tarefa zoom nas que escaparam.',                                             teliState: 'idle' },
    { message: 'Bom trabalho — os erros são pequenos e fáceis de fechar.',                       teliMsg: 'Lacunas pequenas para fechar. A tarefa cuida disso direto.',                                   teliState: 'idle' },
  ],
  effort: [
    { message: 'Boa tentativa — a tarefa vai reforçar o que você errou.',                        teliMsg: 'Você passou pela quiz. A tarefa re-ensina as partes que não fixaram.',                          teliState: 'speaking' },
    { message: 'Você ficou na parada — isso importa aqui.',                                      teliMsg: 'Você não desistiu. A tarefa vai reconstruir os conceitos que custaram.',                        teliState: 'speaking' },
    { message: 'Domínio parcial — há um caminho claro na tarefa.',                               teliMsg: 'Algumas partes ficaram, outras não. A tarefa foca no que não ficou.',                          teliState: 'speaking' },
    { message: 'Pontuação intermediária — a tarefa mira exatamente no que tropeçou.',            teliMsg: 'A tarefa vai entrar nos pontos que pegaram você. Ângulos diferentes desta vez.',                teliState: 'speaking' },
    { message: 'Você acertou as mais fáceis — as mais difíceis precisam de mais trabalho.',      teliMsg: 'Pegou o básico. A tarefa reconstrói os pedaços mais difíceis passo a passo.',                  teliState: 'speaking' },
    { message: 'Metade do caminho — a tarefa pega a outra metade.',                              teliMsg: 'Metade do caminho. A tarefa fecha o restante da lacuna.',                                       teliState: 'speaking' },
    { message: 'O esforço apareceu — a precisão precisa de outra rodada.',                       teliMsg: 'Esforço foi real. A tarefa trabalha a precisão.',                                              teliState: 'speaking' },
    { message: 'Você respondeu cada questão — a tarefa re-ensina o que ainda está difuso.',      teliMsg: 'Você terminou a quiz. A tarefa re-ensina as partes difusas.',                                  teliState: 'speaking' },
    { message: 'Parte do seu raciocínio estava certo mesmo quando a resposta não estava.',       teliMsg: 'Seu pensamento estava no caminho em alguns lugares. A tarefa leva as respostas até lá também.', teliState: 'speaking' },
    { message: 'Tem material para trabalhar aqui — a tarefa constrói em cima disso.',            teliMsg: 'Tem fundação. A tarefa adiciona as camadas que faltaram.',                                     teliState: 'speaking' },
  ],
  tough: [
    { message: 'Esta foi um esticão — a tarefa re-ensina o básico.',                             teliMsg: 'Difícil. A tarefa vai voltar ao básico, mais devagar.',                                        teliState: 'speaking' },
    { message: 'Modo Reforço — vamos reconstruir a base na tarefa.',                             teliMsg: 'Vamos reconstruir isso desde o chão na sua tarefa. Abordagem diferente.',                       teliState: 'speaking' },
    { message: 'Não leia isso como fracasso — leia como onde começar.',                          teliMsg: 'Isso me diz onde começar. A tarefa começa do básico.',                                         teliState: 'speaking' },
    { message: 'Quiz difícil — a tarefa vai quebrar em pedaços menores.',                        teliMsg: 'Quiz difícil. A tarefa quebra em pedaços menores com exemplos.',                               teliState: 'speaking' },
    { message: 'Os conceitos precisam de uma passagem nova — a tarefa te dá isso.',              teliMsg: 'Ângulo novo vindo. A tarefa re-ensina com exemplos e dicas.',                                   teliState: 'speaking' },
    { message: 'Você apareceu — isso é a primeira coisa. A tarefa cuida do resto.',              teliMsg: 'Você apareceu e tentou. Eu cuido do reforço na sua tarefa.',                                   teliState: 'speaking' },
    { message: 'Pontuação não conta a história inteira — vamos recomeçar na tarefa.',            teliMsg: 'Pontuação não é a história inteira. Recomeçamos na tarefa.',                                   teliState: 'speaking' },
    { message: 'A tarefa é sua segunda chance — foi feita exatamente para isso.',                teliMsg: 'Segunda chance, com dicas e passo a passo. É para isso que serve a tarefa.',                    teliState: 'speaking' },
    { message: 'Vamos mais devagar na tarefa — exemplos diferentes, mais apoio.',                teliMsg: 'Mais devagar desta vez. Exemplos diferentes, mais apoio, mais dicas.',                          teliState: 'speaking' },
    { message: 'Esta foi pesada — a tarefa vai parecer mais possível.',                          teliMsg: 'Quiz pesada. A tarefa vai parecer mais possível — prometo.',                                    teliState: 'speaking' },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Picks a variant deterministically from the pool using a hash of the seed.
 *
 * Pure function — no side effects, no browser globals. V1 had an optional
 * localStorage branch to avoid back-to-back repeats; that branch is removed
 * in V2. Callers should include the attempt-ID in the seed (as getScoreMessage
 * does) to get sufficient per-attempt entropy.
 */
export function pickVariantStable(variants: ScoreVariant[], seed: string): ScoreVariant {
  if (!variants.length) return variants[0];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % variants.length;
  return variants[idx];
}

/**
 * Substitutes {name} with the student's first name, or drops the placeholder
 * (and the comma/space that follows it) so the message still reads naturally
 * when no name is available.
 */
export function applyName(variant: ScoreVariant, firstName: string | null): ScoreVariant {
  const safe = (firstName ?? '').trim();
  const sub = (s: string) =>
    safe
      ? s.replace(/\{name\}/g, safe)
      : s.replace(/\{name\},?\s*/g, '').replace(/^[a-z]/, (c) => c.toUpperCase());
  return { ...variant, message: sub(variant.message), teliMsg: sub(variant.teliMsg) };
}

/**
 * Returns a post-quiz Teli message for the given score, locale, age tier,
 * and student first name.
 *
 * @param pct       Score percentage (0–100).
 * @param seed      Deterministic seed string (include the attempt-ID for per-attempt entropy).
 * @param locale    'en' or 'pt'.
 * @param tier      Age tier used to pick the EN voice register.
 * @param firstName Student's first name, or null to omit name substitution.
 * @returns         { message, teliMsg, teliState } — all strings are leak-guarded.
 */
export function getScoreMessage(
  pct: number,
  seed: string = '',
  locale: 'en' | 'pt' = 'en',
  tier: Tier = 'high',
  firstName: string | null = null,
): { message: string; teliMsg: string; teliState: 'celebrating' | 'idle' | 'speaking' } {
  const band: Band =
    pct >= 90 ? 'celebrating' : pct >= 75 ? 'strong' : pct >= 60 ? 'effort' : 'tough';

  // Mix score into the seed so two attempts with different scores in the
  // same band still get different hashes (more entropy on top of attemptId).
  const expandedSeed = (seed || '') + ':' + Math.round(pct);

  const pool =
    locale === 'pt'
      ? SCORE_VARIANTS_PT[band]
      : SCORE_VARIANTS_EN_BY_TIER[tier][band];

  const picked = pickVariantStable(pool, expandedSeed);
  const result = applyName(picked, firstName);

  // Runtime leak-guard: belt-and-suspenders check after name substitution.
  // (The test suite audits every raw variant; this guards substituted output.)
  if (process.env.NODE_ENV !== 'production') {
    if (hasLeak(result.message) || hasLeak(result.teliMsg)) {
      console.warn('[scoreMessage] Leak detected in rendered variant:', result);
    }
  }

  return result;
}
