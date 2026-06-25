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
      // Also test with a trailing parenthetical descriptor removed, e.g.
      // "FACTS (Gots to know)" or "NOTES (Can include takeaways...)".
      const noParen = trimmed.replace(/\s*\([^)]*\)\s*$/, '').trim();
      const candidates = noParen && noParen !== trimmed ? [trimmed, noParen] : [trimmed];
      for (const [section, patterns] of Object.entries(HEADINGS)) {
              for (const c of candidates) {
                      if (patterns.some(p => p.test(c))) return section;
              }
      }
      return null;
}

// ── METADATA EXTRACTION ───────────────────────────────────────────────────────

// Title-case an ALL-CAPS party name, leaving the "v" separator lowercase and
// preserving Scottish/Irish prefixes (McHugh, MacLeod, O'Brien).
function titleCaseName(s) {
      return s.replace(/\s+/g, ' ').trim().split(' ').map(w => {
              if (/^v\.?$/i.test(w)) return 'v';
              if (/^(?:and|of|the|for|on|behalf|&)$/i.test(w)) return w.toLowerCase();
              if (/^Mc[A-Z]/i.test(w)) return 'Mc' + w.charAt(2).toUpperCase() + w.slice(3).toLowerCase();
              if (/^Mac[A-Z]/i.test(w) && w.length > 4) return 'Mac' + w.charAt(3).toUpperCase() + w.slice(4).toLowerCase();
              if (/^O'/i.test(w)) return "O'" + w.charAt(2).toUpperCase() + w.slice(3).toLowerCase();
              return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      }).join(' ');
}

function cleanCaseName(raw) {
      return raw
        .replace(/\s*\bCaseBase\b.*$/i, '')
        .replace(/\s+BC\d[\w]*.*$/i, '')          // CaseBase doc id, e.g. BC9202680
        .replace(/\s*[,\-]\s*BC\w*.*$/i, '')
        .replace(/\s*[\[\(]\d{4}.*$/, '')          // trailing citation
        .replace(/\s+/g, ' ')
        .trim();
}

function extractCaseName(text) {
      // 1) "X v Y" as a standalone heading line (pre-formatted briefs).
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      const allCapsLine = /^([A-Z][A-Z\s,\-'\.&]{2,}?)\s+[Vv]\.?\s+([A-Z][A-Z\s,\-'\.&]{2,}?)(?:\s*[,\-\s]+(?:BC|AC|No)[\w\d\s]+)?(?:\s*[\[\(]\d{4}.*)?$/;
      const titleCaseLine = /^([A-Z][a-z][A-Za-z\s,\-'\.&]{2,}?)\s+[Vv]\.?\s+([A-Z][a-z][A-Za-z\s,\-'\.&]{2,}?)(?:\s*[\[\(]\d{4}.*)?$/;
      for (const line of lines.slice(0, 8)) {
              const clean = line.replace(/\*+/g, '').trim();
              if (titleCaseLine.test(clean)) return cleanCaseName(clean);
              if (allCapsLine.test(clean)) return titleCaseName(cleanCaseName(clean));
      }

  // 2) Full-text scan for an ALL-CAPS party heading, e.g.
  //    "CAROL MARY LOUTH v LOUIS DONALD DIPROSE" (CaseBase / reported judgments).
  const headerAllCaps = text.slice(0, 4000).match(
              /\b([A-Z][A-Z'.\-]+(?:\s+[A-Z][A-Z'.\-]+){0,4})\s+v\.?\s+([A-Z][A-Z'.\-]+(?:\s+[A-Z][A-Z'.\-]+){0,4})\b/);
      if (headerAllCaps) return titleCaseName(cleanCaseName(headerAllCaps[0]));

  // 3) Title-case "X v Y" anywhere near the top (short form, e.g. "Louth v Diprose").
  const titleAnywhere = text.slice(0, 1500).match(
              /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s+v\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/);
      if (titleAnywhere) return cleanCaseName(titleAnywhere[0]);

  // 4) Explicit label.
  const labelMatch = text.match(/^case\s+name\s*[:][ \t]*([^\n]+)$/im);
      if (labelMatch && labelMatch[1].trim()) return cleanCaseName(labelMatch[1]);

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
      const label = text.match(/^court\s*[:][ \t]*([^\n]+)$/im);
      if (label && label[1].trim()) return label[1].trim();
      for (const [p, name] of courts) {
              if (p.test(text)) return name;
      }
      return 'Not specified';
}

// Tidy an ALL-CAPS coram list ("MASON (1) CJ, BRENNAN (2), ... MCHUGH (4) JJ")
// into "Mason CJ, Brennan, Deane, Dawson, Toohey, Gaudron, McHugh JJ".
function cleanCoram(s) {
      return s.replace(/\s*\(\d+\)/g, '')      // drop footnote markers
        .replace(/\s+/g, ' ')
        .split(/\s*,\s*/)
        .map(part => part.trim().split(' ').map(w => {
                if (/^(?:CJ|ACJ|JJ?|JA|FCJ|LJJ?|MR)$/.test(w)) return w;
                if (/^MC[A-Z]/.test(w)) return 'Mc' + w.charAt(2) + w.slice(3).toLowerCase();
                return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        }).join(' '))
        .filter(Boolean)
        .join(', ');
}

function extractJudges(text) {
      const coram = text.match(/(?:coram|before|bench)\s*[:]\s*([^\n]+)/i);
      if (coram && coram[1].trim()) return coram[1].trim().replace(/\s+/g, ' ');
      const label = text.match(/^judges?\s*[:][ \t]*([^\n]+)$/im);
      if (label && label[1].trim()) return label[1].trim();

  // All-caps coram panel near the header (reported / CaseBase judgments).
  const block = text.slice(0, 2500).match(
              /((?:[A-Z][A-Z'.]+\s*(?:\(\d+\))?\s*(?:CJ\s*)?,\s*){2,}[A-Z][A-Z'.]+\s*(?:\(\d+\))?\s+JJ?)/);
      if (block) return cleanCoram(block[1].replace(/^[A-Z]*?(?:AUSTRALIA|WALES|ZEALAND|QUEENSLAND|VICTORIA|TASMANIA|KINGDOM)/, ''));

  // Title-case "Name CJ/J" scan (e.g. "Gibbs CJ"), skipping non-name words so
  // that "Unreported Judgments" no longer reads as a judge.
  const STOP = /^(?:The|High|Court|Full|Chief|Unreported|Judgments?|Judgment|And|Of|Australia|New|South|Wales|Supreme|Federal|Order|Appeal|His|Her|Honour|Reasons?|Page)$/;
      const titlePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(CJ|ACJ|JA|JJ|FCJ|LJJ?|J)\b/g;
      const found = [];
      let m;
      while ((m = titlePattern.exec(text)) !== null) {
              if (STOP.test(m[1].split(' ')[0])) continue;
              found.push(m[1] + ' ' + m[2]);
              if (found.length > 40) break;
      }
      if (found.length > 0) return [...new Set(found)].slice(0, 8).join(', ');
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

// Strip page markers and blank lines; keep meaningful lines intact.
function meaningfulLines(raw) {
      return raw.split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .filter(l => !/^page\s+\d+/i.test(l) && !/^\d+\s+of\s+\d+$/.test(l));
}

// A section is "list-like" when it is built from short bullet/fragment lines
// (e.g. the itemised facts or ratio in a pre-formatted brief) rather than
// flowing prose. Such content must be preserved line-by-line, not flattened
// into run-on sentences.
function looksListy(raw) {
      const lines = meaningfulLines(raw);
      if (lines.length < 3) return false;
      // Explicit list markers: bullets, numbering, arrows, or a "label:" line.
      const explicit = lines.filter(l => /^[•‣◦▪·\-\*]|^\d+[.)]\s|→|:\s*$/.test(l)).length;
      // Itemised briefs put one point per line, so most lines are short.
      const shortLines = lines.filter(l => l.length <= 140).length;
      return explicit >= 2 || (lines.length >= 4 && shortLines >= Math.ceil(lines.length * 0.7));
}

function summariseFacts(raw) {
      if (!raw || raw.length < 10) return 'Not specified';
      // Preserve itemised facts as discrete lines rather than collapsing them.
      if (looksListy(raw)) {
              const lines = meaningfulLines(raw).slice(0, 14);
              return lines.length ? lines.join('\n') : 'Not specified';
      }
      // Otherwise treat as prose: keep up to 5 legally relevant sentences.
  const sentences = raw
        .replace(/\n+/g, ' ')
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 20)
        .filter(s => !/^page\s+\d+/i.test(s) && !/^\d+\s+of\s+\d+$/.test(s));
      if (sentences.length === 0) return 'Not specified';
      return sentences.slice(0, 5).join(' ');
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
      // Ratio frequently itemises controlling principles and quotes key
      // judicial statements — preserve those lines rather than flattening.
      if (looksListy(raw)) {
              const lines = meaningfulLines(raw).slice(0, 14);
              return lines.length ? lines.join('\n') : 'Not specified';
      }
      const clean = raw.replace(/\n+/g, ' ').trim();
      const sentences = clean.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 10);
      return sentences.slice(0, 3).join(' ') || clean.substring(0, 400);
}

function summariseReasoning(raw) {
      if (!raw || raw.length < 10) return 'Not specified';
      // Itemised reasoning (judge sub-headings followed by bullet points, as in
      // a pre-formatted brief) must keep its line structure and per-judge
      // attribution intact rather than being collapsed into prose. A standalone
      // judge name on its own line (e.g. "Gibbs CJ", "Mason & Deane JJ") is a
      // strong attribution signal even when the body is otherwise prose.
  const judgeHeader = /^[A-Z][a-z]+(?:\s+(?:&|and)\s+[A-Z][a-z]+|\s+[A-Z][a-z]+){0,3}\s+(?:CJ|ACJ|JA|JJ|J|FCJ|LJ|LJJ|MR)\.?$/;
      const headerLines = meaningfulLines(raw).filter(l => judgeHeader.test(l));
      if (looksListy(raw) || headerLines.length >= 2) {
              const lines = meaningfulLines(raw).slice(0, 20)
                // Blank line before each judge sub-heading for readable attribution.
                .map((l, i) => (i > 0 && judgeHeader.test(l)) ? '\n' + l : l);
              return lines.length ? lines.join('\n') : 'Not specified';
      }
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
      if (looksListy(raw)) {
              const lines = meaningfulLines(raw).slice(0, 12);
              return lines.length ? lines.join('\n') : 'Not specified';
      }
      const clean = raw.replace(/\n+/g, ' ').trim();
      const sentences = clean.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 10);
      return sentences.slice(0, 3).join(' ') || clean.substring(0, 300);
}

function summariseNotes(raw) {
      if (!raw || /not\s+specified/i.test(raw.trim()) || raw.trim().length < 10) return 'Not specified';
      if (looksListy(raw)) {
              const lines = meaningfulLines(raw).slice(0, 16);
              return lines.length ? lines.join('\n') : 'Not specified';
      }
      const clean = raw.replace(/\n+/g, ' ').trim();
      const sentences = clean.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 10);
      return sentences.slice(0, 4).join(' ') || clean.substring(0, 400);
}

// Hard safety cap so a section is never a multi-thousand-character raw dump.
function clamp(s, maxChars = 900) {
      if (!s) return s;
      s = s.trim();
      if (s.includes('\n')) {                       // list-style: cap by line count
              s = s.split('\n').slice(0, 18).join('\n');
      }
      if (s.length <= maxChars) return s;
      let cut = s.slice(0, maxChars);
      const lastEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
      cut = lastEnd > maxChars * 0.4 ? cut.slice(0, lastEnd + 1) : cut.replace(/\s+\S*$/, '') + '…';
      return cut.trim();
}

// ── SIGNAL-BASED FALLBACK ─────────────────────────────────────────────────────
// For unstructured raw judgments with no headings. Best-effort only: regex can
// locate signal sentences but cannot truly comprehend a judgment.

function fallbackExtract(text) {
      // Always work at sentence granularity. PDF text can arrive as page-sized
      // paragraphs (pdf.js inserts a blank line between pages) or as one big
      // blob; either way the signal matchers below need short units, so split
      // on sentence boundaries rather than paragraphs.
  let units = text.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 30);
      // Strip catalogue / citation / page-count header junk so it can't leak in.
  const junk = /CaseBase|Unreported\s+Judgments|\b\d+\s+Pages\b|ANZ\s+ConvR|Aust\s+Contract\s+R|\bALJR\b|F\.?C\.?\s*\d|BC\d{6}/i;
      units = units.filter(u => !junk.test(u));

  const holdingSignal = /\b(held\s+that|we\s+would\s+(?:allow|dismiss)|appeal\s+(?:should\s+be\s+)?(?:allowed|dismissed)|order(?:ed)?\s+that|judgment\s+(?:for|against)|the\s+court\s+(?:held|ordered|found)|conclude[ds]?\s+that)\b/i;
      const ratioSignal = /\b(the\s+(?:principle|rule|test)\s+(?:is|for)|ratio\s+decidendi|controlling\s+(?:principle|rule)|as\s+a\s+matter\s+of\s+(?:law|principle)|unconscionable)\b/i;
      const dissentSignal = /\b(I\s+(?:respectfully\s+)?dissent|dissenting|in\s+dissent|minority\s+(?:judgment|opinion))\b/i;
      const issueSignal = /\b(the\s+(?:question|issue)\s+(?:is|are|was|for)|whether\s+(?:the|a|an|there|it)|at\s+issue|in\s+dispute|falls?\s+to\s+be\s+(?:determined|decided))\b/i;

  let issueS = '', holdingS = '', ratioS = '', dissentS = '';
      const factS = [], reasoningS = [];

  for (const u of units) {
          if (!issueS && issueSignal.test(u) && u.length < 350) issueS = u;
          else if (!holdingS && holdingSignal.test(u) && u.length < 400) holdingS = u;
          else if (!ratioS && ratioSignal.test(u) && u.length < 400) ratioS = u;
          else if (!dissentS && dissentSignal.test(u) && u.length < 400) dissentS = u;
          else if (factS.length < 4) factS.push(u);
          else if (reasoningS.length < 6) reasoningS.push(u);
  }

  return {
          facts:     factS.length ? factS.join(' ') : 'Not specified',
          issue:     issueS || 'Not specified',
          holding:   holdingS || 'Not specified',
          ratio:     ratioS || 'Not specified',
          reasoning: reasoningS.length ? reasoningS.join(' ') : 'Not specified',
          dissent:   dissentS || 'Not specified',
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
  }

  // Always run the signal fallback and fill any gaps the structured pass left,
  // so a raw judgment (or one with stray "Order"/"Reasons" heading lines) is
  // never returned as all "Not specified". The structured value wins wherever
  // it actually captured content. Dissent is the one exception: for a genuine
  // pre-formatted brief (real FACTS heading or several section headings) we do
  // not fabricate a dissent the document doesn't contain.
  const real = v => v && !/^not\s+specified/i.test(String(v).trim());
      const trustStructured = hasHeadings && (!!segments.facts || Object.keys(segments).length >= 4);
      const fb = fallbackExtract(text);
      const pick = (s, f) => (real(s) ? s : f);
      facts     = pick(facts, fb.facts);
      issue     = pick(issue, fb.issue);
      holding   = pick(holding, fb.holding);
      ratio     = pick(ratio, fb.ratio);
      reasoning = pick(reasoning, fb.reasoning);
      dissent   = real(dissent) ? dissent : (trustStructured ? 'Not specified' : fb.dissent);
      notes     = pick(notes, fb.notes);

  const ns = v => (v && v.trim().length > 3 ? v.trim() : 'Not specified');
      const sec = v => ns(clamp(v));   // section text: clamped so it never dumps raw

  return {
          name:      ns(name),
          citation:  ns(citation),
          court:     ns(court),
          year:      year || '',
          judges:    ns(judges),
          facts:     sec(facts),
          issue:     sec(issue),
          holding:   sec(holding),
          ratio:     sec(ratio),
          reasoning: sec(reasoning),
          dissent:   sec(dissent),
          notes:     sec(notes),
  };
}

module.exports = { extract };
