import {
  PriorityNotificationService,
  type PriorityNotificationDeliveryResult,
  type PriorityNotificationRepairResult,
} from "./priority-notification-service";

const DEFAULT_PRIORITY_DELIVERY_LIMIT = 10;

export type PriorityMaintenanceService = Pick<
  PriorityNotificationService,
  | "quarantineStaleDeliveries"
  | "cancelInvalidExpiryReminders"
  | "repairLifecycleNotifications"
  | "repairSeatingNotifications"
  | "repairExpiryReminders"
  | "deliverDue"
>;

export interface PriorityNotificationMaintenanceOptions {
  staleClaimLimit?: number;
  staleClaimAfterMs?: number;
  cancellationLimit?: number;
  lifecycleRepairLimit?: number;
  seatingRepairLimit?: number;
  expiryRepairLimit?: number;
  deliveryLimit?: number;
}

export interface PriorityNotificationMaintenanceResult {
  staleClaimsQuarantined: number;
  expiryRemindersCancelled: number;
  lifecycleRepair: PriorityNotificationRepairResult;
  seatingRepair: PriorityNotificationRepairResult;
  expiryRepair: PriorityNotificationRepairResult;
  delivery: PriorityNotificationDeliveryResult;
}

/**
 * A bounded scheduler entry point. It intentionally accepts no guild or
 * autopilot setting: lifecycle delivery must continue even when a guild pauses
 * weekly automation.
 */
export async function runPriorityNotificationMaintenance(
  service: PriorityMaintenanceService,
  options: PriorityNotificationMaintenanceOptions = {},
): Promise<PriorityNotificationMaintenanceResult> {
  const staleClaimsQuarantined = await service.quarantineStaleDeliveries(
    options.staleClaimLimit ?? 50,
    options.staleClaimAfterMs ?? 15 * 60 * 1000,
  );
  const expiryRemindersCancelled = await service.cancelInvalidExpiryReminders(
    options.cancellationLimit ?? 50,
  );
  const lifecycleRepair = await service.repairLifecycleNotifications(
    options.lifecycleRepairLimit ?? 50,
  );
  const seatingRepair = await service.repairSeatingNotifications(
    options.seatingRepairLimit ?? 50,
  );
  const expiryRepair = await service.repairExpiryReminders(
    options.expiryRepairLimit ?? 50,
  );
  const delivery = await service.deliverDue(
    options.deliveryLimit ?? DEFAULT_PRIORITY_DELIVERY_LIMIT,
  );

  return {
    staleClaimsQuarantined,
    expiryRemindersCancelled,
    lifecycleRepair,
    seatingRepair,
    expiryRepair,
    delivery,
  };
}
