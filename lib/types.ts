export type ConnectionState = "online" | "offline" | "degraded"
export type ProtocolType = "ESP-NOW" | "LoRa" | "Wi-Fi Bridge" | "Unknown"
export type CommandState = "on" | "off" | "pending" | "fault" | "no-ack"
export type TestResult = "untested" | "passed" | "failed" | "wrong-circuit" | "retry"

export interface UIState {
  id: string
  name: string
  online: boolean
  operatorName: string
  lastHeartbeat: string
}

export interface CHState {
  id: string
  label: string
  online: boolean
  endpoint: string
  signalStrength: number
  lastHeartbeat: string
  bridgeProtocol: ProtocolType
}

export interface ChannelState {
  number: number
  label: string
  phase: "A" | "B" | "C"
  gpio: string
  enabled: boolean
  commandedState: CommandState
  actualState: CommandState
  continuity: "unknown" | "open" | "closed"
  fault: string | null
  lastCommand: string
  lastResponse: string
  testResult: TestResult
}

export interface PDState {
  id: string
  label: string
  online: boolean
  protocol: ProtocolType
  lastHeartbeat: string
  fault: string | null
  channelCount: number
  channels: ChannelState[]
}

export interface MeasurementState {
  voltage: number | null
  continuityStatus: string
  phaseDetected: string
  neutralGroundStatus: string
  freshness: string
}

export interface EventLogEntry {
  id: string
  time: string
  source: string
  target: string
  action: string
  result: string
  channelNumber?: number
  phase?: "A" | "B" | "C"
  notes?: string
}

export interface SystemTelemetry {
  ui: UIState
  ch: CHState
  pd: PDState
  measurements: MeasurementState
  eventLog: EventLogEntry[]
}