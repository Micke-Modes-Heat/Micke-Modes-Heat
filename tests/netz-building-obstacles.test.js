import { describe, expect, it } from 'vitest';
import {
  clipBuildingEndpoint,
  crossesForeignBuilding,
  pointInBuildingPolygon,
  segmentCrossesBuilding,
} from '../src/lib/netz-building-obstacles.js';

const square = [
  {lat: 0, lng: 0},
  {lat: 0, lng: 10},
  {lat: 10, lng: 10},
  {lat: 10, lng: 0},
];

describe('Wärmenetz-Hindernisse durch Gebäude', () => {
  it('erkennt Punkte und Leitungen innerhalb eines Grundrisses', () => {
    expect(pointInBuildingPolygon({lat: 5, lng: 5}, square)).toBe(true);
    expect(pointInBuildingPolygon({lat: 12, lng: 5}, square)).toBe(false);
    expect(segmentCrossesBuilding({lat: 5, lng: -5}, {lat: 5, lng: 15}, square)).toBe(true);
    expect(segmentCrossesBuilding({lat: 12, lng: -5}, {lat: 12, lng: 15}, square)).toBe(false);
  });

  it('ignoriert ausschließlich die Gebäude an den zulässigen Endpunkten', () => {
    const buildings = [
      {id: 1, polygon: square},
      {id: 2, polygon: square.map(point => ({lat: point.lat, lng: point.lng + 20}))},
    ];
    expect(crossesForeignBuilding(
      {lat: 5, lng: -5}, {lat: 5, lng: 35}, buildings, [1, 2],
    )).toBe(false);
    expect(crossesForeignBuilding(
      {lat: 5, lng: -5}, {lat: 5, lng: 15}, buildings, [],
    )).toBe(true);
  });

  it('kürzt einen Anschluss vom Gebäudemittelpunkt bis zur Fassade', () => {
    expect(clipBuildingEndpoint(
      {lat: 5, lng: 5}, {lat: 5, lng: 20}, square,
    )).toEqual({lat: 5, lng: 10});
  });
});
