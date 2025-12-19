export type ActionStatus = "idle" | "loading" | "success" | "error";

export interface ActionState {
  status: ActionStatus;
  message: string;
}
