import { test, expect } from '../../src/core/fixtures/base.fixture';
import { extractUrl } from '../../src/core/intent/url-extractor';
import { TAGS } from '../../src/core/constants';

test.describe(`Intent — URL extraction ${TAGS.SMOKE}`, () => {
  test('a URL at the end of a sentence has the trailing period stripped', () => {
    expect(extractUrl('Discover HRMS at http://localhost:4100.')).toBe('http://localhost:4100');
  });

  test('a URL followed by "Requirement:" is not swallowed into the next sentence', () => {
    const text =
      'Create automation for http://localhost:4100. Requirement: Employee should be able to apply leave.';
    expect(extractUrl(text)).toBe('http://localhost:4100');
  });

  test('a bare localhost URL with no trailing punctuation is returned unchanged', () => {
    expect(extractUrl('http://localhost:4100')).toBe('http://localhost:4100');
  });

  test('an https URL is accepted', () => {
    expect(extractUrl('Go to https://example.com now')).toBe('https://example.com');
  });

  test('a URL with a path preserves the path exactly as supplied', () => {
    expect(extractUrl('See https://example.com/path for details')).toBe('https://example.com/path');
    expect(extractUrl('See https://example.com/path.')).toBe('https://example.com/path');
  });

  test('a URL already ending in a slash is preserved as-is, not rewritten', () => {
    expect(extractUrl('http://localhost:4100/')).toBe('http://localhost:4100/');
  });

  test('a URL wrapped in parentheses/brackets has only the wrapper punctuation stripped', () => {
    expect(extractUrl('(http://localhost:4100)')).toBe('http://localhost:4100');
    expect(extractUrl('[http://localhost:4100]')).toBe('http://localhost:4100');
    expect(extractUrl('the app (http://localhost:4100).')).toBe('http://localhost:4100');
  });

  test('no URL in the text returns undefined', () => {
    expect(extractUrl('Create automation for HRMS in QA')).toBeUndefined();
  });

  test('a URL-shaped but invalid string (bad port after stripping fails) returns undefined', () => {
    expect(extractUrl('http://localhost:41oo')).toBeUndefined();
  });

  test('never hardcodes a specific host — works for any domain, not just localhost/HRMS', () => {
    expect(extractUrl('Create automation for MyApp at https://myapp-qa.company.com.')).toBe(
      'https://myapp-qa.company.com',
    );
  });
});
