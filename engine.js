/**
 * BRIEFED — LOCAL LEGAL EXTRACTION ENGINE v5.0
 * -----------------------------------------------
 * Extracts and summarises the 7 required sections from court judgments
 * and pre-formatted case briefs. Produces concise, practitioner-grade
 * summaries — NOT verbatim dumps.
 *
 * 7 Sections:
 *   01 Relevant Facts    02 Issue       03 Holding
 *   04 Ratio Decidendi   05 Reasoning   06 Dissent   07 Notes
 *
 * Rules:
 *  - Use ONLY information from the source material
 *  - Output concise summaries, not raw text blocks
 *  - If information is missing -> "Not specified"
 *  - Attribute reasoning to specific judges where identifiable
 */
'use strict';

// ── TEXT CLEANING ─────────────────────────────────────────────────────────────

function cleanText(raw) {
      return raw
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
        .replace(/\uFFFD/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{4,}/g, '\n\n\n')
        .trim();
}

// ── HEADING DETECTION ─────────────────────────────────────────────────────────
// Handles: numbered (01/O1/1.), plain, and all-caps variants

const HEADINGS = {
      facts: [
              /^(?:[O0]?1[\.\)]\s*)?relevant\s+facts?\s*[:.]?\s*$/i,
              /^(?:1[\.\)]\s*)?facts?\s*[:.]?\s*$/i,
              /^(?:[O0]?1[\.\)]\s*)?background\s*[:.]?\s*$/i,
              /^(?:[O0]?1[\.\)]\s*)?factual\s+(?:background|matrix)\s*[:.]?\s*$/i,
              /^the\s+facts?\s*[:.]?\s*$/i,
              /^statement\s+of\s+facts?\s*[:.]?\s*$/i,
              /^facts?\s+and\s+background\s*[:.]?\s*$/i,
            ],
      issue: [
              /^(?:[O0]?2[\.\)]\s*)?issues?\s*[:.]?\s*$/i,
              /^(?:2[\.\)]\s*)?legal\s+issues?\s*[:.]?\s*$/i,
              /^(?:[O0]?2[\.\)]\s*)?questions?\s+(?:of\s+law\s*)?[:.]?\s*$/i,
              /^the\s+issues?\s*[:.]?\s*$/i,
              /^issue\s+(?:raised|for\s+determination)\s*[:.]?\s*$/i,
            ],
      holding: [
              /^(?:[O0]?3[\.\)]\s*)?holding\s*[:.]?\s*$/i,
              /^(?:3[\.\)]\s*)?held\s*[:.]?\s*$/i,
              /^(?:[O0]?3[\.\)]\s*)?decision\s*[:.]?\s*$/i,
              /^(?:[O0]?3[\.\)]\s*)?judgment\s*[:.]?\s*$/i,
              /^(?:[O0]?3[\.\)]\s*)?result\s*[:.]?\s*$/i,
              /^(?:[O0]?3[\.\)]\s*)?orders?\s*[:.]?\s*$/i,
              /^the\s+court\s+held\s*[:.]?\s*$/i,
              /^(?:[O0]?3[\.\)]\s*)?conclusion\s*[:.]?\s*$/i,
            ],
      ratio: [
              /^(?:[O0]?4[\.\)]\s*)?ratio\s+decidendi\s*[:.]?\s*$/i,
              /^(?:[O0]?4[\.\)]\s*)?ratio\s*[:.]?\s*$/i,
              /^(?:[O0]?4[\.\)]\s*)?reason(?:s)?\s+for\s+(?:the\s+)?(?:decision|judgment)\s*[:.]?\s*$/i,
              /^(?:[O0]?4[\.\)]\s*)?legal\s+(?:principle|rule|basis)\s*[:.]?\s*$/i,
              /^controlling\s+(?:principle|rule)\s*[:.]?\s*$/i,
            ],
      reasoning: [
              /^(?:[O0]?5[\.\)]\s*)?reasoning\s*[:.]?\s*$/i,
              /^(?:5[\.\)]\s*)?reasons?\s*[:.]?\s*$/i,
              /^(?:[O0]?5[\.\)]\s*)?analysis\s*[:.]?\s*$/i,
              /^(?:[O0]?5[\.\)]\s*)?application\s*[:.]?\s*$/i,
              /^(?:majority\s+)?reasoning\s*[:.]?\s*$/i,
              /^judicial\s+reasoning\s*[:.]?\s*$/i,
            ],
      dissent: [
              /^(?:[O0]?6[\.\)]\s*)?dissent(?:ing\s+(?:judgment|opinion|reasoning))?\s*[:.]?\s*$/i,
              /^(?:6[\.\)]\s*)?minority\s+(?:judgment|opinion)?\s*[:.]?\s*$/i,
              /^(?:[O0]?6[\.\)]\s*)?dissenting\s*[:.]?\s*$/i,
            ],
      notes: [
              /^(?:[O0]?7[\.\)]\s*)?(?:key\s+)?notes?\s*[:.]?\s*$/i,
              /^(?:7[\.\)]\s*)?(?:study\s+)?notes?\s*[:.]?\s*$/i,
              /^(?:[O0]?7[\.\)]\s*)?(?:doctrinal\s+)?significance\s*[:.]?\s*$/i,
              /^(?:[O0]?7[\.\)]\s*)?commentary\s*[:.]?\s*$/i,
              /^(?:[O0]?7[\.\)]\s*)?key\s+principles?\s*[:.]?\s*$/i,
            ],
};

function detectHeading(line) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length > 80) return null;
      for (const [section, patterns] of Object.entries(HEADINGS)) {
              if (patterns.some(p => p.test(trimmed))) return section;
      }
      return null;
}

// ── METADATA EXTRACTION ───────────────────────────────────────────────────────

function extractCaseName(text) {
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // "X v Y" pattern — all-caps or title case, with optional citation suffix
  const allCaps = /^([A-Z][A-Z\s,\-'\.&]{2,}?)\s+[Vv]\.?\s+([A-Z][A-Z\s,\-'\.&]{2,}?)(?:\s*[,\-\s]+(?:BC|AC|No)[\w\d\s]+)?(?:\s*[\[\(]\d{4}.*)?$/;
      const titleCase = /^([A-Z][a-z][A-Za-z\s,\-'\.&]{2,}?)\s+[Vv]\.?\s+([A-Z][a-z][A-Za-z\s,\-'\.&]{2,}?)(?:\s*[\[\(]\d{4}.*)?$/;

  for (const line of lines.slice(0, 8)) {
          const clean = line.replace(/\*+/g, '').trim();
          // Try all-caps first
        if (allCaps.test(clean)) {
                  // Strip trailing citation/case number artifacts
            return clean.replace(/\s*[,\-]\s*BC\w*.*$/i, '').replace(/\s*[\[\(]\d{4}.*$/, '').trim();
        }
          if (titleCase.test(clean)) {
                    return clean.replace(/\s*[\[\(]\d{4}.*$/, '').trim();
          }
          // Simple " v " check as fallback
        if (/\s+v\.?\s+/i.test(clean) && clean.length < 100) {
                  return clean.replace(/\s*[,\-]\s*BC\w*.*$/i, '').replace(/\s*[\[\(]\d{4}.*$/, '').trim();
        }
  }

  const labelMatch = text.match(/^case\s+name\s*[:]\s*(.+)$/im);
      if (labelMatch) return labelMatch[1].trim();

  return 'Not specified';
}

function extractCitation(text) {
      const patterns = [
              /\((\d{4})\)\s+(\d+)\s+(CLR|ALR|ALJR|ACLC|ACSR|FCR|NSWLR|VR|QdR|SASR|WAR|AC|QB|WLR|All\s*ER|HCA)\s+(\d+)/gi,
              /\[(\d{4})\]\s*(\d+)?\s*(CLR|ALR|ALJR|AC|QB|WLR|HCA|UKSC|EWCA)\s+(\d+)/gi,
            ];
      for (const p of patterns) {
              const m = text.match(p);
              if (m) return m[0].trim();
      }
      const broad = text.match(/[\[\(]\d{4}[\]\)]\s+\d*\s*[A-Z]{2,5}\s+\d+/);
      if (broad) return broad[0].trim();
      return 'Not specified';
}

function extractCourt(text) {
      const courts = [
              [/high\s+court\s+of\s+australia/i, 'High Court of Australia'],
              [/\bHCA\b/, 'High Court of Australia'],
              [/federal\s+court\s+of\s+australia/i, 'Federal Court of Australia'],
              [/supreme\s+court\s+of\s+(?:new\s+south\s+wales|nsw)/i, 'Supreme Court of New South Wales'],
              [/supreme\s+court\s+of\s+(?:victoria|vic\b)/i, 'Supreme Court of Victoria'],
              [/supreme\s+court\s+of\s+queensland/i, 'Supreme Court of Queensland'],
              [/supreme\s+court\s+of\s+(?:western\s+australia|\bwa\b)/i, 'Supreme Court of Western Australia'],
              [/supreme\s+court\s+of\s+(?:south\s+australia|\bsa\b)/i, 'Supreme Court of South Australia'],
              [/court\s+of\s+appeal/i, 'Court of Appeal'],
              [/house\s+of\s+lords/i, 'House of Lords'],
              [/privy\s+council/i, 'Privy Council'],
              [/uk\s+supreme\s+court|\bUKSC\b/, 'UK Supreme Court'],
            ];
      const label = text.match(/^court\s*[:]\s*(.+)$/im);
      if (label) return label[1].trim();
      for (const [p, name] of courts) {
              if (p.test(text)) return name;
      }
      return 'Not specified';
}

function extractJudges(text) {
      const coram = text.match(/(?:coram|before|bench)\s*[:]\s*([^\n]+)/i);
      if (coram) return coram[1].trim().replace(/\s+/g, ' ');
      const label = text.match(/^judges?\s*[:]\s*(.+)$/im);
      if (label) return label[1].trim();
      // Scan header for judicial titles
  const header = text.substring(0, 600);
      const found = header.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:CJ|ACJ|JA|JJ?|FCJ|LJJ?|MR|Justice)/g);
      if (found && found.length > 0) return [...new Set(found)].join(', ');
      return 'Not specified';
}

function extractYear(text) {
      const m = text.match(/[\[\(](\d{4})[\]\)]/);
      return m ? m[1] : '';
}

// ── DOCUMENT SEGMENTATION ─────────────────────────────────────────────────────

function segmentDocument(text) {
      const lines = text.split('\n');
      const segments = {};
      let currentSection = null;
      let currentLines = [];
      let preHeadingLines = [];
      let foundFirst = false;

  for (const line of lines) {
          const section = detectHeading(line);
          if (section) {
                    if (currentSection) {
                                segments[currentSection] = (segments[currentSection] || []).concat(currentLines);
                    } else if (!foundFirst) {
                                preHeadingLines = currentLines.slice();
                    }
                    foundFirst = true;
                    currentSection = section;
                    currentLines = [];
          } else {
                    currentLines.push(line);
          }
  }
      if (currentSection) {
              segments[currentSection] = (segments[currentSection] || []).concat(currentLines);
      }

  // Convert arrays to trimmed strings
  const result = {};
      for (const [k, v] of Object.entries(segments)) {
              result[k] = v.join('\n').trim();
      }
      return { segments: result, preHeadingText: preHeadingLines.join('\n').trim() };
}

// ── SUMMARISATION HELPERS ─────────────────────────────────────────────────────
// Produce concise summaries — strip verbatim repetition, keep key points

function summariseFacts(raw) {
      if (!raw || raw.length < 10) return 'Not specified';
      // Split into sentences, keep up to ~4 most legally relevant
  const sentences = raw
        .replace(/\n+/g, ' ')
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 20);
      // Remove sentences that are just headings or page markers
  const filtered = sentences.filter(s => !/^page\s+\d+/i.test(s) && !/^\d+\s+of\s+\d+$/.test(s));
      if (filtered.length === 0) return 'Not specified';
      // Return up to 5 sentences
  return filtered.slice(0, 5).join(' ');
}

function summariseIssue(raw) {
      if (!raw || raw.length < 10) return 'Not specified';
      const clean = raw.replace(/\n+/g, ' ').trim();
      // Keep first 2 sentences maximum
  const sentences = clean.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 10);
      return sentences.slice(0, 2).join(' ') || clean.substring(0, 300);
}

function summariseHolding(raw) {
      if (!raw || raw.length < 10) return 'Not specified';
      const clean = raw.replace(/\n+/g, ' ').trim();
      const sentences = clean.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 10);
      return sentences.slice(0, 3).join(' ') || clean.substring(0, 300);
}

function summariseRatio(raw) {
      if (!raw || raw.length < 10) return 'Not specified';
      const clean = raw.replace(/\n+/g, ' ').trim();
      const sentences = clean.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 10);
      return sentences.slice(0, 3).join(' ') || clean.substring(0, 400);
}

function summariseReasoning(raw) {
      if (!raw || raw.length < 10) return 'Not specified';
      // Preserve judge attribution lines, but cap each judge's contribution
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Check for attributed lines (Judge: reasoning)
  const judgePattern = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:CJ|ACJ|JA|JJ?|FCJ|LJJ?|MR|J|Justice|Lord|Lady|Sir|Dame)\.?)\s*:/;
      const attributed = lines.some(l => judgePattern.test(l));

  if (attributed) {
          // Group by judge, take first 2 sentences per judge
        const result = [];
          let currentJudge = '';
          let currentText = [];

        for (const line of lines) {
                  const m = line.match(judgePattern);
                  if (m) {
                              if (currentJudge && currentText.length > 0) {
                                            const summary = currentText.join(' ').split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
                                            result.push(currentJudge + ': ' + summary);
                              }
                              currentJudge = m[1];
                              currentText = [line.replace(judgePattern, '').trim()];
                  } else if (currentJudge) {
                              currentText.push(line);
                  } else {
                              result.push(line);
                  }
        }
          if (currentJudge && currentText.length > 0) {
                    const summary = currentText.join(' ').split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
                    result.push(currentJudge + ': ' + summary);
          }
          return result.slice(0, 6).join('\n') || 'Not specified';
  }

  // No attribution — take first 4 sentences
  const sentences = raw.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 15);
      return sentences.slice(0, 4).join(' ') || raw.substring(0, 500).trim();
}

function summariseDissent(raw) {
      if (!raw || /not\s+specified/i.test(raw.trim()) || raw.trim().length < 10) return 'Not specified';
      const clean = raw.replace(/\n+/g, ' ').trim();
      const sentences = clean.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 10);
      return sentences.slice(0, 3).join(' ') || clean.substring(0, 300);
}

function summariseNotes(raw) {
      if (!raw || /not\s+specified/i.test(raw.trim()) || raw.trim().length < 10) return 'Not specified';
      const clean = raw.replace(/\n+/g, ' ').trim();
      const sentences = clean.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 10);
      return sentences.slice(0, 4).join(' ') || clean.substring(0, 400);
}

// ── SIGNAL-BASED FALLBACK ─────────────────────────────────────────────────────
// For unstructured raw judgments with no headings

function fallbackExtract(text, metadata) {
      const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 40);

  const holdingSignal = /\b(held|ordered|appeal\s+(?:allowed|dismissed)|judgment\s+(?:for|against)|the\s+court\s+(?:held|ordered|found))\b/i;
      const ratioSignal = /\b(the\s+(?:principle|rule)\s+is|ratio\s+decidendi|controlling\s+(?:principle|rule)|as\s+a\s+matter\s+of\s+(?:law|principle))\b/i;
      const dissentSignal = /\b(dissent(?:ing|ed)?|I\s+respectfully\s+dissent|in\s+dissent|minority\s+(?:judgment|opinion))\b/i;
      const issueSignal = /\b(question(?:s)?\s+(?:is|are|for|of)|whether|the\s+issue|at\s+issue|in\s+dispute)\b/i;

  let issuePara = '', holdingPara = '', ratioPara = '', dissentPara = '';
      const factParas = [], reasoningParas = [];

  for (const para of paras) {
          if (!issuePara && issueSignal.test(para) && para.length < 400) {
                    issuePara = para;
          } else if (!holdingPara && holdingSignal.test(para)) {
                    holdingPara = para;
          } else if (!ratioPara && ratioSignal.test(para)) {
                    ratioPara = para;
          } else if (!dissentPara && dissentSignal.test(para)) {
                    dissentPara = para;
          } else if (factParas.length < 3) {
                    factParas.push(para);
          } else {
                    reasoningParas.push(para);
          }
  }

  return {
          facts:     summariseFacts(factParas.join('\n\n')) || 'Not specified',
          issue:     summariseIssue(issuePara) || 'Not specified',
          holding:   summariseHolding(holdingPara) || 'Not specified',
          ratio:     summariseRatio(ratioPara) || 'Not specified',
          reasoning: summariseReasoning(reasoningParas.join('\n')) || 'Not specified',
          dissent:   summariseDissent(dissentPara) || 'Not specified',
          notes:     'Not specified',
  };
}

// ── AUTO-DERIVE NOTES (from source only) ─────────────────────────────────────

function deriveNotes(segments) {
      const parts = [];
      if (segments.ratio && !/not\s+specified/i.test(segments.ratio)) {
              const first = segments.ratio.split(/(?<=[.!?])\s+/)[0];
              if (first && first.length > 20) parts.push('Key principle: ' + first.trim());
      }
      if (segments.dissent && !/not\s+specified/i.test(segments.dissent)) {
              parts.push('Dissenting judgment present.');
      }
      return parts.length > 0 ? parts.join(' ') : 'Not specified';
}

// ── MAIN EXTRACT FUNCTION ─────────────────────────────────────────────────────

function extract(rawText, filename) {
      const text = cleanText(rawText);

  // Metadata
  const name     = extractCaseName(text);
      const citation = extractCitation(text);
      const court    = extractCourt(text);
      const judges   = extractJudges(text);
      const year     = extractYear(text);

  // Segment
  const { segments, preHeadingText } = segmentDocument(text);
      const hasHeadings = Object.keys(segments).length >= 2;

  let facts, issue, holding, ratio, reasoning, dissent, notes;

  if (hasHeadings) {
          facts     = summariseFacts(segments.facts)         || 'Not specified';
          issue     = summariseIssue(segments.issue)         || 'Not specified';
          holding   = summariseHolding(segments.holding)     || 'Not specified';
          ratio     = summariseRatio(segments.ratio)         || 'Not specified';
          reasoning = summariseReasoning(segments.reasoning) || 'Not specified';
          dissent   = summariseDissent(segments.dissent)     || 'Not specified';
          notes     = segments.notes
                        ? summariseNotes(segments.notes)
                                : deriveNotes(segments);
  } else {
          const fb = fallbackExtract(text);
          facts     = fb.facts;
          issue     = fb.issue;
          holding   = fb.holding;
          ratio     = fb.ratio;
          reasoning = fb.reasoning;
          dissent   = fb.dissent;
          notes     = fb.notes;
  }

  const ns = v => (v && v.trim().length > 3 ? v.trim() : 'Not specified');

  return {
          name:      ns(name),
          citation:  ns(citation),
          court:     ns(court),
          year:      year || '',
          judges:    ns(judges),
          facts:     ns(facts),
          issue:     ns(issue),
          holding:   ns(holding),
          ratio:     ns(ratio),
          reasoning: ns(reasoning),
          dissent:   ns(dissent),
          notes:     ns(notes),
  };
}

module.exports = { extract };
