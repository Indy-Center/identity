import type { Attributes } from './attributes.js';
import type { VatsimProfile } from './vatsim.js';

export type User = {
	id: string;
	cid: string;
	email: string;
	isActive: boolean;
	vatsimData: VatsimProfile;
	attributes: Attributes;
	createdAt: number;
	updatedAt: number;
};
