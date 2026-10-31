import { headerNames } from './directAuthRequestHeaders';
import { isSafeExpiry, validExpiryState } from './directAuthExpiry';
import { matchesDirectAuthTuple } from './directAuthTuple';
import {
  DirectAuthApiError,
  DirectAuthProtocolError,
  isDecimal64,
  isUuid,
  isDirectLoginBody,
  type DirectAuthOperation,
  type DirectAuthOperationKind,
  type RefreshRecoveryLeaseExpiredData,
} from './directAuthTypes';
import { persistDirectAuthOperation, readDirectAuthOperation } from './directAuthOperationStore';

type Schema = {
  ref?: string;
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  decimal?: 'zero' | 'positive' | 'safe';
  format?: string;
  minLength?: number;
  maxLength?: number;
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  items?: Schema;
  oneOf?: Schema[];
  allOf?: Schema[];
  if?: Schema;
  then?: Schema;
  else?: Schema;
};
type Route = { method: string; path: string; codes: Record<string, string[]> };
const SCHEMAS = JSON.parse(
  '{"CsrfTokenData":{"type":"object","required":["csrf_token"],"properties":{"csrf_token":{"type":"string","minLength":1}},"additionalProperties":false},"CsrfTokenEnvelope":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","properties":{"message":{"type":"string","const":"csrf token issued"},"data":{"ref":"CsrfTokenData"}}}]},"CurrentOperationEnvelope":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","const":"current auth operation"},"data":{"ref":"CurrentOperationLookup"}},"additionalProperties":false}]},"CurrentOperationFlow":{"type":"object","additionalProperties":false,"required":["flowId","flowEpoch","revision","lifecycle","authenticated","proofState"],"properties":{"flowId":{"type":"string","format":"uuid"},"flowEpoch":{"type":"string","decimal":"positive"},"revision":{"type":"string","decimal":"positive"},"lifecycle":{"ref":"Lifecycle"},"authenticated":{"type":"boolean"},"proofState":{"type":"string","enum":["ACTIVE","REBOOTSTRAP_REQUIRED"]}}},"CurrentOperationLookup":{"type":"object","additionalProperties":false,"required":["flow","operation"],"properties":{"flow":{"ref":"CurrentOperationFlow"},"operation":{"oneOf":[{"type":"null"},{"ref":"CurrentOperationSummary"}]}}},"CurrentOperationSummary":{"type":"object","additionalProperties":false,"required":["flowId","startingEpoch","operationId","kind","status","resultEpoch","resultRevision","reasonCode","leaseExpiresAt","receiptExpiresAt","clientExpiresAt","effectiveExpiresAt"],"properties":{"flowId":{"type":"string","format":"uuid"},"startingEpoch":{"type":"string","decimal":"positive"},"operationId":{"type":"string","format":"uuid"},"kind":{"type":"string","enum":["LOGIN","REFRESH","LOGOUT"]},"status":{"type":"string","enum":["IN_PROGRESS","SUCCEEDED","NOT_ADMITTED","INVALID_CREDENTIALS","SUPERSEDED","REAUTH_REQUIRED"]},"resultEpoch":{"oneOf":[{"type":"string","decimal":"positive"},{"type":"null"}]},"resultRevision":{"oneOf":[{"type":"string","decimal":"positive"},{"type":"null"}]},"reasonCode":{"oneOf":[{"type":"string","enum":["AUTH_BCRYPT_CAPACITY","AUTH_LOGIN_IN_PROGRESS"]},{"type":"null"}]},"leaseExpiresAt":{"oneOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"receiptExpiresAt":{"oneOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"clientExpiresAt":{"oneOf":[{"type":"string","decimal":"safe"},{"type":"null"}]},"effectiveExpiresAt":{"oneOf":[{"type":"string","decimal":"safe"},{"type":"null"}]}},"allOf":[{"if":{"properties":{"status":{"const":"NOT_ADMITTED"}},"required":["status"]},"then":{"properties":{"reasonCode":{"type":"string","enum":["AUTH_BCRYPT_CAPACITY","AUTH_LOGIN_IN_PROGRESS"]}}},"else":{"properties":{"reasonCode":{"type":"null"}}}},{"if":{"properties":{"status":{"const":"IN_PROGRESS"}},"required":["status"]},"then":{"properties":{"leaseExpiresAt":{"type":"string","format":"date-time"},"receiptExpiresAt":{"type":"null"},"resultEpoch":{"type":"null"},"resultRevision":{"type":"null"}}},"else":{"properties":{"leaseExpiresAt":{"type":"null"},"receiptExpiresAt":{"type":"string","format":"date-time"},"resultEpoch":{"type":"string","decimal":"positive"},"resultRevision":{"type":"string","decimal":"positive"}}}}]},"EnvelopeBase":{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","minLength":1},"data":{}},"additionalProperties":false},"ErrorEnvelopeCurrentOperation400":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","const":"INVALID_LOGIN_PROTOCOL"},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeCurrentOperation404":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","const":"AUTH_FLOW_NOT_FOUND"},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeCurrentOperation409":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","const":"AUTH_FLOW_LEGACY_QUEUED"},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeCurrentOperation503":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","const":"AUTH_STATE_UNAVAILABLE"},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeFlow400":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["INVALID_LOGIN_PROTOCOL"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeFlow409":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_FLOW_GENERATION_STALE","AUTH_FLOW_REBOOTSTRAP_REQUIRED","AUTH_FLOW_LEGACY_QUEUED"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeFlow503":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_STATE_UNAVAILABLE"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeFlowBootstrap400":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["INVALID_LOGIN_PROTOCOL","INVALID_OPERATION_ID"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeFlowBootstrap403":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["CSRF_DENIED","ORIGIN_NOT_ALLOWED"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeFlowBootstrap409":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_FLOW_LEGACY_QUEUED","AUTH_OPERATION_ID_REUSED","AUTH_OPERATION_RECEIPT_EXPIRED","AUTH_OPERATION_SUPERSEDED"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeFlowBootstrap429":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","const":"AUTH_FLOW_BOOTSTRAP_RATE_LIMITED"},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeFlowBootstrap503":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_STATE_UNAVAILABLE","LOGIN_PROTOCOL_DISABLED"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeFlowRead404":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_FLOW_REQUIRED","AUTH_FLOW_COOKIE_INVALID","AUTH_FLOW_NOT_FOUND"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeLogin400":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["INVALID_LOGIN_PROTOCOL","INVALID_OPERATION_ID","INVALID_AUTH_FLOW_TUPLE","INVALID_LOGIN_REQUEST"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeLogin401":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["INVALID_CREDENTIALS"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeLogin403":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["CSRF_DENIED","ORIGIN_NOT_ALLOWED"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeLogin409":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_LOGIN_IN_PROGRESS","LOGIN_RESULT_REQUIRES_RECOVERY","AUTH_LOGIN_SUPERSEDED","REAUTH_REQUIRED","AUTH_OPERATION_ID_REUSED","AUTH_OPERATION_RECEIPT_EXPIRED","LEGACY_QUEUE_ACTIVE"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeLogin429":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_OPERATION_RECEIPT_LIMIT"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeLogin503":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_BCRYPT_CAPACITY","AUTH_STATE_UNAVAILABLE","LOGIN_PROTOCOL_DISABLED"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeLogout400":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["INVALID_LOGIN_PROTOCOL","INVALID_OPERATION_ID","INVALID_AUTH_FLOW_TUPLE"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeLogout401":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_SESSION_INVALID"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeLogout403":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["CSRF_DENIED","ORIGIN_NOT_ALLOWED"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeLogout409":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_FLOW_ID_MISMATCH","AUTH_FLOW_EPOCH_STALE","AUTH_OPERATION_ID_REUSED","AUTH_OPERATION_SUPERSEDED","AUTH_OPERATION_RECEIPT_EXPIRED"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeLogout428":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_FLOW_REQUIRED","AUTH_FLOW_COOKIE_INVALID"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeLogout503":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_STATE_UNAVAILABLE"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeOperation400":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["INVALID_OPERATION_ID","INVALID_AUTH_FLOW_TUPLE","INVALID_LOGIN_PROTOCOL"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeOperation404":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["LOGIN_OPERATION_NOT_FOUND"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeOperation503":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_STATE_UNAVAILABLE"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRebootstrap400":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["INVALID_LOGIN_PROTOCOL","INVALID_OPERATION_ID","INVALID_AUTH_FLOW_TUPLE"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRebootstrap403":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["CSRF_DENIED","ORIGIN_NOT_ALLOWED"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRebootstrap404":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_FLOW_NOT_FOUND"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRebootstrap409":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_FLOW_EPOCH_STALE","AUTH_OPERATION_ID_REUSED","AUTH_OPERATION_RECEIPT_EXPIRED","AUTH_OPERATION_SUPERSEDED"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRebootstrap429":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_OPERATION_RECEIPT_LIMIT"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRebootstrap503":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_STATE_UNAVAILABLE"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRecovery400":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["INVALID_OPERATION_ID","INVALID_AUTH_FLOW_TUPLE","INVALID_LOGIN_PROTOCOL"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRecovery403":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["CSRF_DENIED","ORIGIN_NOT_ALLOWED"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRecovery404":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["LOGIN_OPERATION_NOT_FOUND"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRecovery409":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["LOGIN_RESULT_NOT_RECOVERABLE","AUTH_LOGIN_SUPERSEDED","REAUTH_REQUIRED","AUTH_OPERATION_ID_REUSED"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRecovery503":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_STATE_UNAVAILABLE"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRefresh400":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["INVALID_LOGIN_PROTOCOL","INVALID_OPERATION_ID","INVALID_AUTH_FLOW_TUPLE","INVALID_CLIENT_EXPIRY"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRefresh401":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_SESSION_INVALID"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRefresh403":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["CSRF_DENIED","ORIGIN_NOT_ALLOWED"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRefresh409":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_FLOW_ID_MISMATCH","AUTH_FLOW_EPOCH_STALE","AUTH_OPERATION_ID_REUSED","AUTH_OPERATION_SUPERSEDED","AUTH_REFRESH_STALE","AUTH_OPERATION_RECEIPT_EXPIRED"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRefresh428":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_FLOW_REQUIRED","AUTH_FLOW_COOKIE_INVALID"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRefresh503":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_STATE_UNAVAILABLE"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRefreshRecovery400":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["INVALID_LOGIN_PROTOCOL","INVALID_OPERATION_ID","INVALID_AUTH_FLOW_TUPLE"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRefreshRecovery403":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["CSRF_DENIED","ORIGIN_NOT_ALLOWED"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRefreshRecovery404":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_FLOW_NOT_FOUND","REFRESH_OPERATION_NOT_FOUND"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRefreshRecovery429":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_OPERATION_RECEIPT_LIMIT"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRefreshRecovery503":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_STATE_UNAVAILABLE"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRefreshRecoveryCurrent409":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_OPERATION_RECEIPT_EXPIRED","AUTH_OPERATION_SUPERSEDED"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRefreshRecoveryGet403":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["ORIGIN_NOT_ALLOWED"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRefreshRecoveryLeaseExpired409":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","const":"AUTH_RECOVERY_LEASE_EXPIRED"},"data":{"ref":"RefreshRecoveryLeaseExpiredData"}},"additionalProperties":false}]},"ErrorEnvelopeRefreshRecoveryPost409":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_OPERATION_ID_REUSED","AUTH_OPERATION_RECEIPT_EXPIRED","AUTH_OPERATION_SUPERSEDED","AUTH_RECOVERY_RESULT_STALE","AUTH_RECOVERY_IN_PROGRESS","AUTH_RECOVERY_ALREADY_COMPLETED"]},"data":{"type":"null"}},"additionalProperties":false}]},"ErrorEnvelopeRefreshRecoveryStatus409":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["AUTH_OPERATION_ID_REUSED","AUTH_OPERATION_RECEIPT_EXPIRED","AUTH_OPERATION_SUPERSEDED","AUTH_RECOVERY_RESULT_STALE"]},"data":{"type":"null"}},"additionalProperties":false}]},"FlowData":{"type":"object","required":["flowId","flowEpoch","revision","lifecycle","authenticated","refreshGeneration","currentTicket","pendingOperations","lastLogoutReceipt","lastRefreshReceipt","lastQueueCancelReceipt","rebootstrapReason","loginProtocol","flowCookieGeneration","flowCookieExpiresAt"],"properties":{"flowId":{"type":"string","format":"uuid"},"flowEpoch":{"type":"string","decimal":"positive"},"revision":{"type":"string","decimal":"positive"},"lifecycle":{"ref":"Lifecycle"},"authenticated":{"type":"boolean"},"refreshGeneration":{"type":"string","decimal":"zero"},"currentTicket":{"type":"null"},"pendingOperations":{"type":"array","items":{"ref":"PendingOperation"}},"lastLogoutReceipt":{"oneOf":[{"type":"null"},{"ref":"LogoutReceipt"}]},"lastRefreshReceipt":{"oneOf":[{"type":"null"},{"ref":"RefreshReceipt"}]},"lastQueueCancelReceipt":{"oneOf":[{"type":"null"},{"ref":"QueueCancelReceipt"}]},"rebootstrapReason":{"type":["string","null"],"enum":["EXISTING","CREATED","INVALID_COOKIE","EXPIRED_COOKIE",null]},"loginProtocol":{"type":"string","const":"direct-v2"},"flowCookieGeneration":{"type":"string","decimal":"positive"},"flowCookieExpiresAt":{"type":"string","format":"date-time"}},"additionalProperties":false},"FlowEnvelope":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","properties":{"message":{"type":"string","const":"auth flow"},"data":{"ref":"FlowData"}}}]},"InProgressEnvelope":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","properties":{"message":{"type":"string","const":"LOGIN_IN_PROGRESS"},"data":{"ref":"OperationInProgressData"}}}]},"Lifecycle":{"type":"string","enum":["ANONYMOUS","AUTHENTICATING","AUTHENTICATED","RETIRED"]},"LogoutData":{"type":"object","required":["logoutReceipt"],"properties":{"logoutReceipt":{"ref":"LogoutReceipt"}},"additionalProperties":false},"LogoutEnvelope":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","properties":{"message":{"type":"string","const":"logout committed"},"data":{"ref":"LogoutData"}}}]},"LogoutReceipt":{"type":"object","required":["operationId","committed","flowEpoch","revision","completedAt"],"properties":{"operationId":{"type":"string","format":"uuid"},"committed":{"type":"boolean"},"flowEpoch":{"type":"string","decimal":"positive"},"revision":{"type":"string","decimal":"positive"},"completedAt":{"type":"string","format":"date-time"}},"additionalProperties":false},"OperationInProgressData":{"type":"object","required":["operationId","flowId","startingEpoch","status","resultEpoch","resultRevision"],"properties":{"operationId":{"type":"string","format":"uuid"},"flowId":{"type":"string","format":"uuid"},"startingEpoch":{"type":"string","decimal":"positive"},"status":{"type":"string","const":"IN_PROGRESS"},"resultEpoch":{"type":"null"},"resultRevision":{"type":"null"}},"additionalProperties":false},"PendingOperation":{"type":"object","required":["operationId","kind"],"properties":{"operationId":{"type":"string","format":"uuid"},"kind":{"type":"string","enum":["LOGOUT","REFRESH","QUEUE_CANCEL","DIRECT_LOGIN"]}},"additionalProperties":false},"QueueCancelReceipt":{"type":"object","required":["operationId","committed","flowEpoch","revision"],"properties":{"operationId":{"type":"string","format":"uuid"},"committed":{"type":"boolean"},"flowEpoch":{"type":"string","decimal":"positive"},"revision":{"type":"string","decimal":"positive"}},"additionalProperties":false},"RebootstrapData":{"type":"object","additionalProperties":false,"required":["flow","operationId","startingEpoch","resultEpoch","resultRevision"],"properties":{"flow":{"ref":"CurrentOperationFlow"},"operationId":{"type":"string","format":"uuid"},"startingEpoch":{"type":"string","decimal":"positive"},"resultEpoch":{"type":"string","decimal":"positive"},"resultRevision":{"type":"string","decimal":"positive"}}},"RebootstrapEnvelope":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","const":"auth flow rebootstrap"},"data":{"ref":"RebootstrapData"}},"additionalProperties":false}]},"RefreshEnvelope":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","properties":{"message":{"type":"string","const":"token refreshed"},"data":{"ref":"TokenData"}}}]},"RefreshReceipt":{"type":"object","required":["operationId","committed","flowEpoch","revision","resultGeneration"],"properties":{"operationId":{"type":"string","format":"uuid"},"committed":{"type":"boolean"},"flowEpoch":{"type":"string","decimal":"positive"},"revision":{"type":"string","decimal":"positive"},"resultGeneration":{"type":"string","decimal":"positive"}},"additionalProperties":false},"RefreshRecoveryCurrentData":{"type":"object","additionalProperties":false,"required":["flowId","operationId","startingEpoch","recoveryOperationId","status","leaseExpiresAt","resultEpoch","resultRevision","clientExpiresAt","effectiveExpiresAt"],"properties":{"flowId":{"type":"string","format":"uuid"},"operationId":{"type":"string","format":"uuid"},"startingEpoch":{"type":"string","decimal":"positive"},"recoveryOperationId":{"oneOf":[{"type":"string","format":"uuid"},{"type":"null"}]},"status":{"type":"string","enum":["NONE","IN_PROGRESS","SUCCEEDED","RESULT_STALE","EXPIRED"]},"leaseExpiresAt":{"oneOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"resultEpoch":{"oneOf":[{"type":"string","decimal":"positive"},{"type":"null"}]},"resultRevision":{"oneOf":[{"type":"string","decimal":"positive"},{"type":"null"}]},"clientExpiresAt":{"oneOf":[{"type":"string","decimal":"safe"},{"type":"null"}]},"effectiveExpiresAt":{"oneOf":[{"type":"string","decimal":"safe"},{"type":"null"}]}},"allOf":[{"if":{"properties":{"status":{"const":"NONE"}},"required":["status"]},"then":{"properties":{"recoveryOperationId":{"type":"null"},"leaseExpiresAt":{"type":"null"},"resultEpoch":{"type":"null"},"resultRevision":{"type":"null"}}}},{"if":{"properties":{"status":{"const":"IN_PROGRESS"}},"required":["status"]},"then":{"properties":{"recoveryOperationId":{"type":"string","format":"uuid"},"leaseExpiresAt":{"type":"string","format":"date-time"},"resultEpoch":{"type":"null"},"resultRevision":{"type":"null"}}}},{"if":{"properties":{"status":{"enum":["RESULT_STALE","EXPIRED"]}},"required":["status"]},"then":{"properties":{"recoveryOperationId":{"type":"string","format":"uuid"},"leaseExpiresAt":{"type":"null"},"resultEpoch":{"type":"null"},"resultRevision":{"type":"null"}}}},{"if":{"properties":{"status":{"const":"SUCCEEDED"}},"required":["status"]},"then":{"properties":{"recoveryOperationId":{"type":"string","format":"uuid"},"leaseExpiresAt":{"type":"null"},"resultEpoch":{"type":"string","decimal":"positive"},"resultRevision":{"type":"string","decimal":"positive"}}}}]},"RefreshRecoveryCurrentEnvelope":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","const":"current refresh recovery"},"data":{"ref":"RefreshRecoveryCurrentData"}},"additionalProperties":false}]},"RefreshRecoveryInProgressData":{"type":"object","additionalProperties":false,"required":["flowId","operationId","recoveryOperationId","startingEpoch","status","leaseExpiresAt"],"properties":{"flowId":{"type":"string","format":"uuid"},"operationId":{"type":"string","format":"uuid"},"recoveryOperationId":{"type":"string","format":"uuid"},"startingEpoch":{"type":"string","decimal":"positive"},"status":{"type":"string","const":"IN_PROGRESS"},"leaseExpiresAt":{"type":"string","format":"date-time"}}},"RefreshRecoveryInProgressEnvelope":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","const":"RECOVERY_IN_PROGRESS"},"data":{"ref":"RefreshRecoveryInProgressData"}},"additionalProperties":false}]},"RefreshRecoveryLeaseExpiredData":{"type":"object","additionalProperties":false,"required":["flowId","operationId","recoveryOperationId","startingEpoch","status","leaseExpiresAt","resultEpoch","resultRevision","clientExpiresAt","effectiveExpiresAt"],"properties":{"flowId":{"type":"string","format":"uuid"},"operationId":{"type":"string","format":"uuid"},"recoveryOperationId":{"type":"string","format":"uuid"},"startingEpoch":{"type":"string","decimal":"positive"},"status":{"type":"string","const":"LEASE_EXPIRED"},"leaseExpiresAt":{"type":"string","format":"date-time"},"resultEpoch":{"type":"null"},"resultRevision":{"type":"null"},"clientExpiresAt":{"oneOf":[{"type":"string","decimal":"safe"},{"type":"null"}]},"effectiveExpiresAt":{"oneOf":[{"type":"string","decimal":"safe"},{"type":"null"}]}}},"RefreshRecoveryStatusData":{"type":"object","additionalProperties":false,"required":["flowId","operationId","recoveryOperationId","startingEpoch","status","leaseExpiresAt","resultEpoch","resultRevision","clientExpiresAt","effectiveExpiresAt"],"properties":{"flowId":{"type":"string","format":"uuid"},"operationId":{"type":"string","format":"uuid"},"recoveryOperationId":{"type":"string","format":"uuid"},"startingEpoch":{"type":"string","decimal":"positive"},"status":{"type":"string","enum":["NOT_RECEIVED","IN_PROGRESS","SUCCEEDED"]},"leaseExpiresAt":{"oneOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"resultEpoch":{"oneOf":[{"type":"string","decimal":"positive"},{"type":"null"}]},"resultRevision":{"oneOf":[{"type":"string","decimal":"positive"},{"type":"null"}]},"clientExpiresAt":{"oneOf":[{"type":"string","decimal":"safe"},{"type":"null"}]},"effectiveExpiresAt":{"oneOf":[{"type":"string","decimal":"safe"},{"type":"null"}]}},"allOf":[{"if":{"properties":{"status":{"enum":["NOT_RECEIVED","IN_PROGRESS"]}},"required":["status"]},"then":{"properties":{"resultEpoch":{"type":"null"},"resultRevision":{"type":"null"}}}},{"if":{"properties":{"status":{"const":"IN_PROGRESS"}},"required":["status"]},"then":{"properties":{"leaseExpiresAt":{"type":"string","format":"date-time"}}},"else":{"properties":{"leaseExpiresAt":{"type":"null"}}}},{"if":{"properties":{"status":{"const":"SUCCEEDED"}},"required":["status"]},"then":{"properties":{"resultEpoch":{"type":"string","decimal":"positive"},"resultRevision":{"type":"string","decimal":"positive"}}}}]},"RefreshRecoveryStatusEnvelope":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","const":"refresh recovery status"},"data":{"ref":"RefreshRecoveryStatusData"}},"additionalProperties":false}]},"RefreshSessionRecoveryData":{"type":"object","additionalProperties":false,"required":["flowId","operationId","recoveryOperationId","startingEpoch","resultEpoch","resultRevision","access_token","expires_in"],"properties":{"flowId":{"type":"string","format":"uuid"},"operationId":{"type":"string","format":"uuid"},"recoveryOperationId":{"type":"string","format":"uuid"},"startingEpoch":{"type":"string","decimal":"positive"},"resultEpoch":{"type":"string","decimal":"positive"},"resultRevision":{"type":"string","decimal":"positive"},"access_token":{"type":"string","minLength":1},"expires_in":{"type":"string","decimal":"positive"}}},"RefreshSessionRecoveryEnvelope":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","const":"refresh session recovered"},"data":{"ref":"RefreshSessionRecoveryData"}},"additionalProperties":false}]},"TerminalOperationData":{"type":"object","required":["operationId","flowId","startingEpoch","status","resultEpoch","resultRevision","reasonCode"],"properties":{"operationId":{"type":"string","format":"uuid"},"flowId":{"type":"string","format":"uuid"},"startingEpoch":{"type":"string","decimal":"positive"},"status":{"type":"string","enum":["SUCCEEDED","INVALID_CREDENTIALS","SUPERSEDED","REAUTH_REQUIRED","NOT_ADMITTED"]},"resultEpoch":{"type":"string","decimal":"positive"},"resultRevision":{"type":"string","decimal":"positive"},"reasonCode":{"type":["string","null"],"enum":["AUTH_BCRYPT_CAPACITY","AUTH_LOGIN_IN_PROGRESS",null]}},"additionalProperties":false,"allOf":[{"if":{"properties":{"status":{"const":"NOT_ADMITTED"}},"required":["status"]},"then":{"properties":{"reasonCode":{"type":"string","enum":["AUTH_BCRYPT_CAPACITY","AUTH_LOGIN_IN_PROGRESS"]}}},"else":{"properties":{"reasonCode":{"type":"null"}}}}]},"TerminalStatusEnvelope":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","properties":{"message":{"type":"string","const":"login operation"},"data":{"ref":"TerminalOperationData"}}}]},"TokenData":{"type":"object","required":["access_token","expires_in"],"properties":{"access_token":{"type":"string","minLength":1},"expires_in":{"type":"string","decimal":"positive"}},"additionalProperties":false},"TokenEnvelope":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","properties":{"message":{"type":"string","const":"login success"},"data":{"ref":"TokenData"}}}]},"ErrorEnvelopeRefreshRecoveryPost400":{"allOf":[{"ref":"EnvelopeBase"},{"type":"object","required":["message","data"],"properties":{"message":{"type":"string","enum":["INVALID_LOGIN_PROTOCOL","INVALID_OPERATION_ID","INVALID_AUTH_FLOW_TUPLE","INVALID_CLIENT_EXPIRY"]},"data":{"type":"null"}},"additionalProperties":false}]}}',
) as Record<string, Schema>;
export type DirectAuthRoute =
  | 'flow'
  | 'login'
  | 'loginStatus'
  | 'loginRecovery'
  | 'refresh'
  | 'logout'
  | 'csrf'
  | 'currentOperation'
  | 'rebootstrap'
  | 'refreshRecovery'
  | 'refreshRecoveryStatus'
  | 'refreshRecoveryCurrent'
  | 'bootstrap';
const ROUTES = JSON.parse(
  '{"flow":{"method":"get","path":"/flow","codes":{"200":["FlowEnvelope"],"400":["ErrorEnvelopeFlow400"],"404":["ErrorEnvelopeFlowRead404"],"409":["ErrorEnvelopeFlow409"],"503":["ErrorEnvelopeFlow503"]}},"login":{"method":"post","path":"/login","codes":{"200":["TokenEnvelope"],"202":["InProgressEnvelope"],"400":["ErrorEnvelopeLogin400"],"401":["ErrorEnvelopeLogin401"],"403":["ErrorEnvelopeLogin403"],"409":["ErrorEnvelopeLogin409"],"429":["ErrorEnvelopeLogin429"],"503":["ErrorEnvelopeLogin503"]}},"loginStatus":{"method":"get","path":"/login/operations/{operationId}","codes":{"200":["TerminalStatusEnvelope"],"202":["InProgressEnvelope"],"400":["ErrorEnvelopeOperation400"],"404":["ErrorEnvelopeOperation404"],"503":["ErrorEnvelopeOperation503"]}},"loginRecovery":{"method":"post","path":"/login/operations/{operationId}/session-recovery","codes":{"200":["TokenEnvelope"],"202":["InProgressEnvelope"],"400":["ErrorEnvelopeRecovery400"],"403":["ErrorEnvelopeRecovery403"],"404":["ErrorEnvelopeRecovery404"],"409":["ErrorEnvelopeRecovery409"],"503":["ErrorEnvelopeRecovery503"]}},"refresh":{"method":"post","path":"/token/refresh","codes":{"200":["RefreshEnvelope"],"400":["ErrorEnvelopeRefresh400"],"401":["ErrorEnvelopeRefresh401"],"403":["ErrorEnvelopeRefresh403"],"409":["ErrorEnvelopeRefresh409"],"428":["ErrorEnvelopeRefresh428"],"503":["ErrorEnvelopeRefresh503"]}},"logout":{"method":"post","path":"/logout","codes":{"200":["LogoutEnvelope"],"400":["ErrorEnvelopeLogout400"],"401":["ErrorEnvelopeLogout401"],"403":["ErrorEnvelopeLogout403"],"409":["ErrorEnvelopeLogout409"],"428":["ErrorEnvelopeLogout428"],"503":["ErrorEnvelopeLogout503"]}},"csrf":{"method":"get","path":"/token/csrf","codes":{"200":["CsrfTokenEnvelope"]}},"currentOperation":{"method":"get","path":"/flow/current-operation","codes":{"200":["CurrentOperationEnvelope"],"400":["ErrorEnvelopeCurrentOperation400"],"404":["ErrorEnvelopeCurrentOperation404"],"409":["ErrorEnvelopeCurrentOperation409"],"503":["ErrorEnvelopeCurrentOperation503"]}},"rebootstrap":{"method":"post","path":"/flow/rebootstrap","codes":{"200":["RebootstrapEnvelope"],"400":["ErrorEnvelopeRebootstrap400"],"403":["ErrorEnvelopeRebootstrap403"],"404":["ErrorEnvelopeRebootstrap404"],"409":["ErrorEnvelopeRebootstrap409"],"429":["ErrorEnvelopeRebootstrap429"],"503":["ErrorEnvelopeRebootstrap503"]}},"refreshRecovery":{"method":"post","path":"/token/refresh/operations/{operationId}/session-recovery","codes":{"200":["RefreshSessionRecoveryEnvelope"],"202":["RefreshRecoveryInProgressEnvelope"],"400":["ErrorEnvelopeRefreshRecoveryPost400"],"403":["ErrorEnvelopeRefreshRecovery403"],"404":["ErrorEnvelopeRefreshRecovery404"],"409":["ErrorEnvelopeRefreshRecoveryPost409"],"429":["ErrorEnvelopeRefreshRecovery429"],"503":["ErrorEnvelopeRefreshRecovery503"]}},"refreshRecoveryStatus":{"method":"get","path":"/token/refresh/operations/{operationId}/session-recovery/{recoveryOperationId}","codes":{"200":["RefreshRecoveryStatusEnvelope"],"400":["ErrorEnvelopeRefreshRecovery400"],"403":["ErrorEnvelopeRefreshRecoveryGet403"],"404":["ErrorEnvelopeRefreshRecovery404"],"409":["ErrorEnvelopeRefreshRecoveryStatus409","ErrorEnvelopeRefreshRecoveryLeaseExpired409"],"503":["ErrorEnvelopeRefreshRecovery503"]}},"refreshRecoveryCurrent":{"method":"get","path":"/token/refresh/operations/{operationId}/session-recovery/current","codes":{"200":["RefreshRecoveryCurrentEnvelope"],"400":["ErrorEnvelopeRefreshRecovery400"],"403":["ErrorEnvelopeRefreshRecoveryGet403"],"404":["ErrorEnvelopeRefreshRecovery404"],"409":["ErrorEnvelopeRefreshRecoveryCurrent409","ErrorEnvelopeRefreshRecoveryLeaseExpired409"],"503":["ErrorEnvelopeRefreshRecovery503"]}},"bootstrap":{"method":"post","path":"/flows","codes":{"200":["FlowEnvelope"],"400":["ErrorEnvelopeFlowBootstrap400"],"403":["ErrorEnvelopeFlowBootstrap403"],"409":["ErrorEnvelopeFlowBootstrap409"],"429":["ErrorEnvelopeFlowBootstrap429"],"503":["ErrorEnvelopeFlowBootstrap503"]}}}',
) as Record<DirectAuthRoute, Route>;

export type DirectAuthTuple = {
  flowId: string;
  startingEpoch: string;
  operationId?: string;
  recoveryOperationId?: string;
};
export type DirectAuthRequest = {
  route: DirectAuthRoute;
  tuple?: DirectAuthTuple;
  csrf?: string;
  body?: { email: string; password: string };
  mutation?: { kind: DirectAuthOperationKind; operation: DirectAuthOperation; storage?: Storage };
  fetcher?: typeof fetch;
};
export { DirectAuthApiError, DirectAuthProtocolError } from './directAuthTypes';
function matches(value: unknown, schema: Schema): boolean {
  if (schema.ref && !matches(value, SCHEMAS[schema.ref])) return false;
  if (schema.oneOf && schema.oneOf.filter((part) => matches(value, part)).length !== 1)
    return false;
  if (schema.allOf && !schema.allOf.every((part) => matches(value, part))) return false;
  if (
    schema.if &&
    !(matches(value, schema.if)
      ? !schema.then || matches(value, schema.then)
      : !schema.else || matches(value, schema.else))
  )
    return false;
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : [];
  if (
    types.length &&
    !types.some((t) =>
      t === 'null'
        ? value === null
        : t === 'array'
          ? Array.isArray(value)
          : t === 'object'
            ? value !== null && typeof value === 'object' && !Array.isArray(value)
            : t === 'integer'
              ? Number.isInteger(value)
              : typeof value === t,
    )
  )
    return false;
  if (
    schema.decimal === 'safe'
      ? !isSafeExpiry(value)
      : schema.decimal && !isDecimal64(value, schema.decimal === 'zero')
  )
    return false;
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) return false;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return false;
    if (schema.format === 'uuid' && !isUuid(value)) return false;
    if (
      schema.format === 'date-time' &&
      (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
        !Number.isFinite(Date.parse(value)))
    )
      return false;
  }
  if (Array.isArray(value) && schema.items && !value.every((v) => matches(v, schema.items!)))
    return false;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (schema.required?.some((key) => !Object.hasOwn(obj, key))) return false;
    if (
      schema.additionalProperties === false &&
      Object.keys(obj).some((key) => !Object.hasOwn(schema.properties ?? {}, key))
    )
      return false;
    if (
      schema.properties &&
      Object.entries(schema.properties).some(
        ([key, part]) => Object.hasOwn(obj, key) && !matches(obj[key], part),
      )
    )
      return false;
  }
  return true;
}
export function parseDirectAuthResponse(
  route: DirectAuthRoute,
  status: number,
  body: unknown,
  tuple?: DirectAuthTuple,
  retryAfter: string | null = null,
): unknown {
  const candidates: readonly string[] | undefined = (
    ROUTES[route].codes as Record<string, string[]>
  )[String(status)];
  if (!candidates || !candidates.some((name) => matches(body, SCHEMAS[name])))
    throw new DirectAuthProtocolError();
  const envelope = body as { message: string; data: unknown };
  if (
    !validExpiryState(route, status, envelope.data) ||
    !matchesDirectAuthTuple(envelope.data, tuple, route)
  )
    throw new DirectAuthProtocolError();
  if (
    status === 429 &&
    (!retryAfter || !/^(?:\d+|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), .+ GMT)$/.test(retryAfter))
  )
    throw new DirectAuthProtocolError();
  if (status >= 400)
    throw new DirectAuthApiError(
      status,
      envelope.message,
      envelope.data as RefreshRecoveryLeaseExpiredData | null,
      retryAfter,
    );
  return body;
}
export async function requestDirectAuth<T>(request: DirectAuthRequest): Promise<T> {
  const route: Route = ROUTES[request.route];
  const { tuple, mutation } = request;
  if (route.method === 'post' && (!mutation || !request.csrf || !request.csrf.trim()))
    throw new DirectAuthProtocolError();
  const kinds: Partial<Record<DirectAuthRoute, DirectAuthOperationKind>> = {
    bootstrap: 'BOOTSTRAP',
    login: 'LOGIN',
    loginRecovery: 'LOGIN_RECOVERY',
    refresh: 'REFRESH',
    logout: 'LOGOUT',
    rebootstrap: 'REBOOTSTRAP',
    refreshRecovery: 'REFRESH_RECOVERY',
  };
  if (
    mutation &&
    (mutation.kind !== kinds[request.route] || (request.route !== 'bootstrap' && !tuple))
  )
    throw new DirectAuthProtocolError();
  if (
    (request.route === 'login') !== Boolean(request.body) ||
    (request.body && !isDirectLoginBody(request.body))
  )
    throw new DirectAuthProtocolError();
  if (
    mutation &&
    tuple &&
    request.route !== 'refreshRecovery' &&
    tuple.operationId &&
    tuple.operationId !== mutation.operation.operationId
  )
    throw new DirectAuthProtocolError();
  let sourceExpiresAt: number | undefined;
  if (mutation && tuple && request.route === 'refreshRecovery') {
    if (tuple.recoveryOperationId && tuple.recoveryOperationId !== mutation.operation.operationId)
      throw new DirectAuthProtocolError();
    const source = readDirectAuthOperation('REFRESH', mutation.storage);
    if (
      !source ||
      source.expiresAt <= Date.now() ||
      source.flowId !== tuple.flowId ||
      source.startingEpoch !== tuple.startingEpoch ||
      source.operationId !== tuple.operationId
    )
      throw new DirectAuthProtocolError();
    sourceExpiresAt = source.expiresAt;
  }
  if (route.method === 'get' && (mutation || request.csrf || request.body))
    throw new DirectAuthProtocolError();
  if ((request.route === 'flow' || request.route === 'csrf') && tuple)
    throw new DirectAuthProtocolError();
  if (
    tuple &&
    (!isUuid(tuple.flowId) ||
      !isDecimal64(tuple.startingEpoch) ||
      (tuple.operationId !== undefined && !isUuid(tuple.operationId)) ||
      (tuple.recoveryOperationId !== undefined && !isUuid(tuple.recoveryOperationId)))
  )
    throw new DirectAuthProtocolError();
  const headers = new Headers();
  if (request.route !== 'csrf') headers.set('X-Auth-Login-Protocol', 'direct-v2');
  if (tuple) {
    headers.set('X-Auth-Flow-Id', tuple.flowId);
    headers.set('X-Auth-Flow-Epoch', tuple.startingEpoch);
  }
  if (request.csrf) headers.set('X-CSRF-TOKEN', request.csrf);
  let path = route.path;
  for (const key of ['operationId', 'recoveryOperationId'] as const)
    if (path.includes(`{${key}}`)) {
      if (!tuple?.[key]) throw new DirectAuthProtocolError();
      path = path.replace(`{${key}}`, encodeURIComponent(tuple[key]));
    }
  if (mutation) {
    if (
      tuple &&
      (mutation.operation.flowId !== tuple.flowId ||
        mutation.operation.startingEpoch !== tuple.startingEpoch)
    )
      throw new DirectAuthProtocolError();
    if (headerNames[request.route])
      headers.set(headerNames[request.route]!, mutation.operation.operationId);
    persistDirectAuthOperation(mutation.kind, mutation.operation, mutation.storage);
    if (request.route === 'refresh')
      headers.set('X-Auth-Client-Expires-At', String(mutation.operation.expiresAt));
    if (request.route === 'refreshRecovery')
      headers.set('X-Auth-Recovery-Client-Expires-At', String(mutation.operation.expiresAt));
  }
  if (request.body) headers.set('Content-Type', 'application/json');
  const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
  let response: Response;
  if (sourceExpiresAt !== undefined && mutation) {
    const now = Date.now();
    if (sourceExpiresAt <= now || mutation.operation.expiresAt <= now)
      throw new DirectAuthProtocolError();
  }
  try {
    response = await (request.fetcher ?? fetch)(`${base}/api/v1/auth${path}`, {
      method: route.method.toUpperCase(),
      credentials: 'include',
      headers,
      ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      cache: 'no-store',
    });
  } catch {
    throw new DirectAuthProtocolError();
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new DirectAuthProtocolError();
  }
  const expected =
    mutation && tuple
      ? {
          ...tuple,
          ...(request.route === 'refreshRecovery'
            ? { recoveryOperationId: mutation.operation.operationId }
            : { operationId: mutation.operation.operationId }),
        }
      : tuple;
  return parseDirectAuthResponse(
    request.route,
    response.status,
    body,
    expected,
    response.headers.get('Retry-After'),
  ) as T;
}
