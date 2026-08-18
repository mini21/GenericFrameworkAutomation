import { test, expect } from '../../src/core/fixtures/base.fixture';
import { TAGS } from '../../src/core/constants';
import { extractApplicationName } from '../../src/core/intent/application-name-extractor';

test.describe(`Intent — application name extraction ${TAGS.SMOKE}`, () => {
  test('extracts a brand-new application name from "Discover <Name> at <url>" — never seen in any registry', () => {
    expect(extractApplicationName('Discover Amazon at https://www.amazon.com')).toEqual({
      id: 'amazon',
      name: 'Amazon',
    });
  });

  test('extracts from "Create automation for <Name> at <url>. Requirement: ..." — a different, never-hardcoded application', () => {
    expect(
      extractApplicationName(
        'Create automation for Salesforce at https://example.com. Requirement: Login as admin.',
      ),
    ).toEqual({ id: 'salesforce', name: 'Salesforce' });
  });

  test('a multi-word name is slugified into a valid application id, not rejected', () => {
    expect(extractApplicationName('Discover My Project at https://myproject.example.com')).toEqual({
      id: 'my-project',
      name: 'My Project',
    });
  });

  test('an environment clause after the name does not get folded into the extracted name', () => {
    expect(
      extractApplicationName('Create automation for Salesforce at https://example.com in QA'),
    ).toEqual({ id: 'salesforce', name: 'Salesforce' });
  });

  test('text with no discover/generate/automate phrasing yields no match — never guessed', () => {
    expect(extractApplicationName('Run smoke tests for Leave module in QA')).toBeUndefined();
  });
});
