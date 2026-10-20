/**
 * Order service barrel — re-exports all functions from sub-modules.
 *
 * import * as orderService from '../services/orderService.js'
 * still works because everything is re-exported here.
 */

export type { OrderFilters } from './orderQueries.js'
export type { CreateOrderInput } from './orderMutations.js'

export {
  listOrders, getOrder,
  listCustomerOrders, getCustomerOrder, trackOrder,
  exportOrdersCsv,
} from './orderQueries.js'

export {
  createOrder, requestOrderCancellation,
  updateOrderStatus, updateTracking, cancelOrder,
  generateInvoiceHtml,
} from './orderMutations.js'
