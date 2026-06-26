export const ORDER_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  RUNNER_DELIVERED: 'runner_delivered',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

export const ACTIVE_CLIENT_STATUSES = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.ACCEPTED,
  ORDER_STATUS.RUNNER_DELIVERED,
];

export const USER_ROLE = {
  CLIENT: 'client',
  RUNNER: 'runner',
};
