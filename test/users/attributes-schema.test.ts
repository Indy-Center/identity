import { describe, expect, it } from 'vitest';
import type { Attributes, AttributePatch } from '../../src/client/attributes';
import { AttributesSchema, AttributePatchSchema } from '../../src/users/attributes-schema';

describe('AttributesSchema', () => {
	it('parses an empty object', () => {
		expect(AttributesSchema.parse({})).toEqual({});
	});

	it('parses known fields', () => {
		const v: Attributes = AttributesSchema.parse({
			preferredName: 'Steve',
			pronouns: 'he/him',
			operatingInitials: 'SC',
			discordId: '12345'
		});
		expect(v.preferredName).toBe('Steve');
		expect(v.operatingInitials).toBe('SC');
	});

	it('parses disabled* known fields', () => {
		const v: Attributes = AttributesSchema.parse({
			disabledReason: 'spam',
			disabledAt: 1700000000000,
			disabledBy: 'admin-cid'
		});
		// Type narrowing: these are typed strings/numbers, not unknown.
		const reason: string | undefined = v.disabledReason;
		const at: number | undefined = v.disabledAt;
		const by: string | undefined = v.disabledBy;
		expect(reason).toBe('spam');
		expect(at).toBe(1700000000000);
		expect(by).toBe('admin-cid');
	});

	it('rejects non-string disabledReason / non-number disabledAt', () => {
		expect(() => AttributesSchema.parse({ disabledReason: 123 })).toThrow();
		expect(() => AttributesSchema.parse({ disabledAt: 'never' })).toThrow();
	});

	it('rejects bad operating initials format', () => {
		expect(() => AttributesSchema.parse({ operatingInitials: 'sc' })).toThrow();
		expect(() => AttributesSchema.parse({ operatingInitials: 'SCC' })).toThrow();
		expect(() => AttributesSchema.parse({ operatingInitials: '12' })).toThrow();
	});

	it('preserves unknown keys via catchall', () => {
		const v = AttributesSchema.parse({
			preferredName: 'Steve',
			'community.profileColor': 'blue'
		});
		expect(v['community.profileColor']).toBe('blue');
	});
});

describe('AttributePatchSchema', () => {
	it('accepts null for known fields (deletion sentinel)', () => {
		const v: AttributePatch = AttributePatchSchema.parse({
			preferredName: null,
			pronouns: null
		});
		expect(v.preferredName).toBeNull();
		expect(v.pronouns).toBeNull();
	});

	it('accepts a mix of values, nulls, and absent keys', () => {
		const v = AttributePatchSchema.parse({
			preferredName: 'Steve',
			pronouns: null
		});
		expect(v.preferredName).toBe('Steve');
		expect(v.pronouns).toBeNull();
		expect('operatingInitials' in v).toBe(false);
	});

	it('rejects bad operating initials in patch', () => {
		expect(() => AttributePatchSchema.parse({ operatingInitials: 'abc' })).toThrow();
	});

	it('accepts null and values for disabled* keys (deletion + set)', () => {
		const v: AttributePatch = AttributePatchSchema.parse({
			disabledReason: null,
			disabledAt: 1700000000000,
			disabledBy: 'admin-cid'
		});
		expect(v.disabledReason).toBeNull();
		expect(v.disabledAt).toBe(1700000000000);
		expect(v.disabledBy).toBe('admin-cid');
	});

	it('preserves unknown keys via catchall (set or delete)', () => {
		const v = AttributePatchSchema.parse({ 'community.x': 1 });
		expect(v['community.x']).toBe(1);
		const v2 = AttributePatchSchema.parse({ 'community.x': null });
		expect(v2['community.x']).toBeNull();
	});
});
