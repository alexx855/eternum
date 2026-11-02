import { Direction } from "@bibliothecadao/types";

export const DIRECTION_OPTIONS = [
  { label: "East", value: String(Direction.EAST) },
  { label: "NE", value: String(Direction.SOUTH_EAST) },
  { label: "NW", value: String(Direction.SOUTH_WEST) },
  { label: "West", value: String(Direction.WEST) },
  { label: "SW", value: String(Direction.NORTH_WEST) },
  { label: "SE", value: String(Direction.NORTH_EAST) },
];
