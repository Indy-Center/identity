import type { Attributes } from './attributes';
import type { VatsimProfile } from './vatsim';

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
