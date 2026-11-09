import {THEOKYKLOS_SEGMENTS} from '../theokyklos-data';
import {SECTOR_IDS, type CuratorId, type SectorId} from './registry';
import type {FunctionShare} from './types';

/** An Aurora adapter, never a replacement for the fourteen-part Theokyklos.
 * User clarification, 2026-11-05: link the gods of the OLD model to the NEW
 * model. A letter's prose is not a newly invented letter → Olympian canon.
 * The ordinary Olympian function already named by a source sector supplies
 * its unit of mass. Existing accompanying figures remain in the source copy.
 * South has two ordinary Olympian functions, explicitly sharing that unit.
 * Zenith, nadir, hearth, entrance and exit remain independent source elements;
 * they are not extra cards and contribute no additional mass to a nine draw.
 */
export const SOURCE_MODEL_ID='theokyklos-fourteen-v1';
export const SECONDARY_MODEL_ID='aurora-nine-v1';
export const SOURCE_PROJECTION_VERSION='source-sector-olympians-v2';
const functions:Readonly<Record<SectorId,readonly CuratorId[]>>={
  northwest:['apollo'],north:['athena'],northeast:['artemis'],
  west:['poseidon'],center:['dionysus'],east:['hermes'],
  southwest:['demeter'],south:['ares','aphrodite'],southeast:['hephaestus'],
};
export const SOURCE_SECTOR_PROJECTION=Object.freeze(Object.fromEntries(SECTOR_IDS.map(id=>[id,
  Object.freeze(functions[id].map(deityId=>Object.freeze({deityId,share:1/functions[id].length}))),
]))) as Readonly<Record<SectorId,readonly FunctionShare[]>>;
export const SOURCE_CIRCLE_REFERENCE=Object.freeze(THEOKYKLOS_SEGMENTS.map(segment=>Object.freeze({
  id:segment.id,title:Object.freeze({...segment.title}),patrons:Object.freeze({...segment.patrons}),meaning:Object.freeze({...segment.essence}),
})));
export function sourceSectorFunctions(id:SectorId):readonly FunctionShare[]{
  const result=SOURCE_SECTOR_PROJECTION[id];
  if(!result)throw new Error('AURORA_UNKNOWN_SOURCE_SECTOR');
  return result;
}
