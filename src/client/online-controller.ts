// src/client/online-controller.ts
// Mirrors the live.env.vnas.vatsim.net/data-feed/controllers.json shape.

export type VnasVatsimData = {
	cid: string;
	realName: string;
	controllerInfo: string;
	userRating: string;
	callsign: string;
	loginTime?: string;
	[key: string]: unknown;
};

export type VnasPosition = {
	facilityId: string;
	facilityName: string;
	positionId: string;
	positionName: string;
	positionType: string;
	radioName: string;
	defaultCallsign: string;
	frequency: number;
	isPrimary: boolean;
	isActive: boolean;
	callsign?: string;
	[key: string]: unknown;
};

export type OnlineController = {
	artccId: string;
	primaryFacilityId: string;
	primaryPositionId: string;
	role: string;
	positions: VnasPosition[];
	isActive: boolean;
	isObserver: boolean;
	loginTime: string;
	vatsimData: VnasVatsimData;
	[key: string]: unknown;
};
