// src/dev-fixtures.ts
//
// Hardcoded test fixtures for local development. Only active when
// `COOKIE_DOMAIN === 'localhost'` — never in production.
//
// Each fixture is keyed by CID. When a consumer calls `getSessionContext` and
// the user's CID matches a fixture, the fixture wins over whatever the live
// vNAS / VATSIM feeds say (or don't say). This lets us exercise the
// pilot-flying and controller-controlling UI flows without filing a real
// flight plan or signing on to vNAS for testing.
//
// To add a fixture:
//   - For a pilot: add an entry to `flightPlanFixtures` with the CID and a
//     FlightPlan-shaped value.
//   - For a controller: add an entry to `onlineControllerFixtures` with the
//     CID and an OnlineController-shaped value.
//
// Real data feeds drive the production path. These fixtures are pure
// dev-only test scaffolding.

import type { FlightPlan } from './client/flight-plan';
import type { OnlineController } from './client/online-controller';

function isDevMode(env: Cloudflare.Env): boolean {
	return env.COOKIE_DOMAIN === 'localhost';
}

// CID 10000002 — KSDF → KCMH IFR, B738. Real route per FlightAware
// analysis: SPILR1.BNGIN.PODGY.FISUL.JAKTZ2 at FL240.
const pilot10000002: FlightPlan = {
	flight_rules: 'I',
	aircraft: 'B738/L',
	aircraft_faa: 'B738/L',
	aircraft_short: 'B738',
	departure: 'KSDF',
	arrival: 'KCMH',
	alternate: '',
	cruise_tas: '430',
	altitude: '24000',
	deptime: '1500',
	enroute_time: '0040',
	fuel_time: '0140',
	remarks: 'PBN/A1B1C1D1S2 NAV/RNVD1E2A1 OPR/INDY CENTER DEV FIXTURE /V/',
	route: 'SPILR1 BNGIN PODGY FISUL JAKTZ JAKTZ2'
};

// CID 10000003 — IND_APP combined approach. The real ZID ARTCC tree (per
// data-api.vnas.vatsim.net) folds Indianapolis tower and approach into a
// single AtctTracon facility with id `IND`. Walking from `IND` downward
// surfaces the IND facility itself plus its child ATCT airports (BAK, MIE,
// AID, HBE) for the pinned-airports row.
const controller10000003: OnlineController = {
	artccId: 'ZID',
	primaryFacilityId: 'IND',
	primaryPositionId: 'DEV_FIXTURE_IND_APP',
	role: 'Controller',
	positions: [
		{
			facilityId: 'IND',
			facilityName: 'Indianapolis ATCT/TRACON',
			positionId: 'DEV_FIXTURE_IND_APP',
			positionName: 'Approach',
			positionType: 'AtctTracon',
			radioName: 'Indianapolis Approach',
			defaultCallsign: 'IND_APP',
			frequency: 119050000,
			isPrimary: true,
			isActive: true,
			callsign: 'IND_APP'
		}
	],
	isActive: true,
	isObserver: false,
	loginTime: '2026-05-15T12:00:00.0000000Z',
	vatsimData: {
		cid: '10000003',
		realName: 'Indy Center Dev Fixture',
		controllerInfo: 'Local dev fixture — not a real controller',
		userRating: 'C1',
		callsign: 'IND_APP'
	}
};

const flightPlanFixtures: Map<string, FlightPlan> = new Map([['10000002', pilot10000002]]);

const onlineControllerFixtures: Map<string, OnlineController> = new Map([
	['10000003', controller10000003]
]);

/**
 * Look up a fixture flight plan for the given CID. Returns null when the
 * environment is not local dev or the CID has no fixture.
 */
export function getFixtureFlightPlan(env: Cloudflare.Env, cid: string): FlightPlan | null {
	if (!isDevMode(env)) {
		return null;
	}
	return flightPlanFixtures.get(cid) ?? null;
}

/**
 * Look up a fixture controller session for the given CID. Returns null when
 * the environment is not local dev or the CID has no fixture.
 */
export function getFixtureOnlineController(
	env: Cloudflare.Env,
	cid: string
): OnlineController | null {
	if (!isDevMode(env)) {
		return null;
	}
	return onlineControllerFixtures.get(cid) ?? null;
}
