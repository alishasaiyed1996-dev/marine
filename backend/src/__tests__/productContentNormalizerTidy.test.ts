import test from 'node:test'
import assert from 'node:assert/strict'
import { tidy } from '../services/productContentNormalizer.js'

/**
 * S1 regression test for the control-character strip inside tidy().
 *
 * The stripped set must stay exactly: \u0000-\u0008, \u000B, \u000C,
 * \u000E-\u001F and \u007F → replaced by a space. Tab/newline/CR survive this
 * step and are collapsed by the \s+ pass. C1 controls (\u0080-\u009F) were
 * never stripped and must still survive.
 */
test('tidy replaces every stripped control character with a space', () => {
  // Directly concatenated (no separators — they would survive and pollute the
  // expectation): covers 0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F and DEL.
  const stripped = '\u0000\u0001\u0007\u0008\u000B\u000C\u000E\u001F\u007F'
  const result = tidy(`a${stripped}b`)
  // Each stripped character becomes one space, then \s+ collapses the run.
  assert.equal(result, 'a b')
})

test('tidy keeps tab/newline/CR (collapsed to spaces like before)', () => {
  assert.equal(tidy('a\tb\nc\rd'), 'a b c d')
})

test('tidy keeps C1 control characters and printable text untouched', () => {
  assert.equal(tidy('pump \u0085 seal'), 'pump \u0085 seal')
  assert.equal(tidy('AX-4  Damper, NFKC ﬁ ½'), 'AX-4 Damper, NFKC fi 1⁄2')
})

test('tidy collapses runs of stripped characters into one space', () => {
  assert.equal(tidy('a\u0000\u0000\u000B\u0007b'), 'a b')
})

test('tidy still trims and fixes punctuation spacing', () => {
  assert.equal(tidy('  end .  '), 'end.')
})
