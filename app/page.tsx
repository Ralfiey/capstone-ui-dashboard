"use client"

import { defaultSystemTelemetry } from "@/lib/default-system"
import type { ChannelState, SystemTelemetry } from "@/lib/types"
import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

type ConnectionStatus = "Connected" | "Offline" | "Connecting"

type VoltageHistoryPoint = {
  time: string
  voltage: number
}

const DEFAULT_IP = "192.168.0.204"

function mapChannelStateToLegacyStatus(
  channel: ChannelState
): "active" | "inactive" | "fault" {
  if (channel.commandedState === "fault" || channel.actualState === "fault" || channel.fault) {
    return "fault"
  }

  if (channel.commandedState === "on" || channel.actualState === "on") {
    return "active"
  }

  return "inactive"
}

function getActiveChannelCount(channels: ChannelState[]) {
  return channels.filter(
    (channel) => channel.commandedState === "on" || channel.actualState === "on"
  ).length
}

export default function HomePage() {
  const [esp32Ip, setEsp32Ip] = useState(DEFAULT_IP)
  const [savedIp, setSavedIp] = useState(DEFAULT_IP)
  const [status, setStatus] = useState<ConnectionStatus>("Offline")
  const [lastUpdate, setLastUpdate] = useState("Never")

  const [telemetry, setTelemetry] = useState<SystemTelemetry>(defaultSystemTelemetry)
  const [channels, setChannels] = useState<ChannelState[]>(defaultSystemTelemetry.pd.channels)
  const [voltageHistory, setVoltageHistory] = useState<VoltageHistoryPoint[]>([])
  const [eventLog, setEventLog] = useState(defaultSystemTelemetry.eventLog)

  function addLog(source: string, target: string, action: string, result: string, notes?: string) {
    setEventLog((prev) => [
      {
        id: `evt-${Date.now()}`,
        time: new Date().toLocaleTimeString(),
        source,
        target,
        action,
        result,
        notes,
      },
      ...prev.slice(0, 24),
    ])
  }

  function saveDeviceIp() {
    localStorage.setItem("esp32_ip", esp32Ip)
    setSavedIp(esp32Ip)
    addLog("AP", "CH Endpoint", "Save IP", `Saved ${esp32Ip}`)
  }

  async function fetchTelemetry() {
    try {
      setStatus("Connecting")

      const res = await fetch(`http://${savedIp}/telemetry`, {
        method: "GET",
      })

      if (!res.ok) {
        throw new Error("Failed to fetch telemetry")
      }

      const json = await res.json()
      const now = new Date().toLocaleTimeString()

      setTelemetry((prev) => {
        const updatedChannels = prev.pd.channels.map((channel) => {
          const channelKey = `channel${channel.number}`
          const fallbackRelayKey = `relay${channel.number}`

          const reportedState = Boolean(
            json[channelKey] ?? json[fallbackRelayKey] ?? (channel.actualState === "on")
          )

          return {
            ...channel,
            actualState: reportedState ? "on" : "off",
            fault: json[`channel${channel.number}Fault`] ?? channel.fault,
            lastResponse: now,
          }
        })

        setChannels(updatedChannels)

        return {
          ...prev,
          ch: {
            ...prev.ch,
            endpoint: savedIp,
            online: true,
            signalStrength: Number(json.signalStrength ?? prev.ch.signalStrength ?? 0),
            cameraOnline: Boolean(json.cameraOnline ?? prev.ch.cameraOnline),
            securityState:
              json.securityState === "alarm" ||
              json.securityState === "armed" ||
              json.securityState === "locked" ||
              json.securityState === "idle"
                ? json.securityState
                : prev.ch.securityState,
            lastHeartbeat: now,
          },
          pd: {
            ...prev.pd,
            online: true,
            protocol:
              json.pdProtocol === "ESP-NOW" ||
              json.pdProtocol === "LoRa" ||
              json.pdProtocol === "Wi-Fi Bridge" ||
              json.pdProtocol === "Unknown"
                ? json.pdProtocol
                : prev.pd.protocol,
            lastHeartbeat: now,
            fault: json.pdFault ?? null,
            channels: updatedChannels,
            channelCount: updatedChannels.length,
          },
          measurements: {
            ...prev.measurements,
            voltage:
              json.voltage === undefined || json.voltage === null
                ? prev.measurements.voltage
                : Number(json.voltage),
            current:
              json.current === undefined || json.current === null
                ? prev.measurements.current
                : Number(json.current),
            power:
              json.power === undefined || json.power === null
                ? prev.measurements.power
                : Number(json.power),
            continuityStatus: json.continuityStatus ?? prev.measurements.continuityStatus,
            phaseDetected: json.phaseDetected ?? prev.measurements.phaseDetected,
            neutralGroundStatus:
              json.neutralGroundStatus ?? prev.measurements.neutralGroundStatus,
            freshness: `Updated ${now}`,
          },
          camera: {
            ...prev.camera,
            online: Boolean(json.cameraOnline ?? prev.camera.online),
            latestImageUrl: json.latestImageUrl ?? prev.camera.latestImageUrl,
            lastCaptureTime: json.lastCaptureTime ?? prev.camera.lastCaptureTime,
            triggerSource: json.triggerSource ?? prev.camera.triggerSource,
          },
          security: {
            ...prev.security,
            alarmActive: Boolean(json.alarmActive ?? prev.security.alarmActive),
            intrusionDetected: Boolean(
              json.intrusionDetected ?? prev.security.intrusionDetected
            ),
            auditTrailEnabled: Boolean(
              json.auditTrailEnabled ?? prev.security.auditTrailEnabled
            ),
            remoteLockout: Boolean(json.remoteLockout ?? prev.security.remoteLockout),
            killSignalReady: Boolean(json.killSignalReady ?? prev.security.killSignalReady),
            lastAlarmTime: json.lastAlarmTime ?? prev.security.lastAlarmTime,
          },
        }
      })

      setVoltageHistory((prev) => [
        ...prev.slice(-19),
        {
          time: now,
          voltage: Number(json.voltage ?? 0),
        },
      ])

      setStatus("Connected")
      setLastUpdate(now)
    } catch (error) {
      console.log("ESP32 offline", error)
      setStatus("Offline")

      setTelemetry((prev) => ({
        ...prev,
        ch: {
          ...prev.ch,
          endpoint: savedIp,
          online: false,
        },
        pd: {
          ...prev.pd,
          online: false,
        },
      }))
    }
  }

  async function toggleChannel(channelNumber: number, state: boolean) {
    if (state) {
      const confirmed = window.confirm(
        `Activate Channel ${channelNumber}? This will send a live command to the panel device.`
      )
      if (!confirmed) return
    }

    const action = state ? "on" : "off"

    try {
      const res = await fetch(`http://${savedIp}/channel/${channelNumber}/${action}`, {
        method: "GET",
      })

      if (!res.ok) {
        throw new Error(`Channel ${channelNumber} ${action} failed`)
      }

      setChannels((prev) =>
        prev.map((channel) => {
          if (channel.number !== channelNumber) return channel

          return {
            ...channel,
            commandedState: state ? "on" : "off",
            actualState: state ? "on" : "off",
            lastCommand: `${action.toUpperCase()} @ ${new Date().toLocaleTimeString()}`,
            lastResponse: new Date().toLocaleTimeString(),
          }
        })
      )

      addLog("AP", `PD Channel ${channelNumber}`, `Set ${action}`, "Success")
      fetchTelemetry()
    } catch (error) {
      console.log(`Failed to toggle channel ${channelNumber}`, error)
      setStatus("Offline")
      addLog("AP", `PD Channel ${channelNumber}`, `Set ${action}`, "Failed")
    }
  }

  async function allOutputsOff() {
    const activeChannels = channels.filter(
      (channel) => channel.commandedState === "on" || channel.actualState === "on"
    )

    for (const channel of activeChannels) {
      try {
        await fetch(`http://${savedIp}/channel/${channel.number}/off`, {
          method: "GET",
        })
      } catch (error) {
        console.log(`Failed to turn off channel ${channel.number}`, error)
      }
    }

    setChannels((prev) =>
      prev.map((channel) => ({
        ...channel,
        commandedState: "off",
        actualState: "off",
        lastCommand: `OFF @ ${new Date().toLocaleTimeString()}`,
        lastResponse: new Date().toLocaleTimeString(),
      }))
    )

    addLog("AP", "All Channels", "Emergency Off", "Completed")
    fetchTelemetry()
  }

  useEffect(() => {
    const storedIp = localStorage.getItem("esp32_ip")
    if (storedIp) {
      setEsp32Ip(storedIp)
      setSavedIp(storedIp)
    }
  }, [])

  useEffect(() => {
    setTelemetry((prev) => ({
      ...prev,
      eventLog,
      ch: {
        ...prev.ch,
        endpoint: savedIp,
      },
      pd: {
        ...prev.pd,
        channels,
        channelCount: channels.length,
      },
    }))
  }, [channels, eventLog, savedIp])

  useEffect(() => {
    fetchTelemetry()
    const interval = setInterval(fetchTelemetry, 2000)
    return () => clearInterval(interval)
  }, [savedIp])

  const activeChannelCount = getActiveChannelCount(channels)

  return (
    <main className="min-h-screen bg-muted/30 p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Remote Panel Testing Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            AP interface for Communication Hub and Panel Device control
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-5">
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">AP Status</div>
              <div className="mt-2 text-lg font-medium">{status}</div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">CH Status</div>
              <div className="mt-2 text-lg font-medium">
                {telemetry.ch.online ? "Online" : "Offline"}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">PD Status</div>
              <div className="mt-2 text-lg font-medium">
                {telemetry.pd.online ? "Online" : "Offline"}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Active Channels</div>
              <div className="mt-2 text-lg font-medium">{activeChannelCount}</div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Last Update</div>
              <div className="mt-2 text-lg font-medium">{lastUpdate}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-end">
            <div className="flex-1 space-y-2">
              <div className="text-sm font-medium">CH Endpoint</div>
              <p className="text-sm text-muted-foreground">
                Enter the current IP address used by the AP to reach the communication hub.
              </p>
              <Input
                value={esp32Ip}
                onChange={(e) => setEsp32Ip(e.target.value)}
                placeholder="192.168.0.204"
              />
              <p className="text-sm text-muted-foreground">
                Connected CH: {telemetry.ch.endpoint}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={saveDeviceIp}>Save</Button>
              <Button variant="outline" onClick={fetchTelemetry}>
                Refresh
              </Button>
              <Button variant="destructive" onClick={allOutputsOff}>
                All Outputs Off
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div>
                <h2 className="text-lg font-semibold">Communication Hub</h2>
                <p className="text-sm text-muted-foreground">
                  Wireless bridge between the AP and the panel device
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-sm text-muted-foreground">Hub ID</div>
                  <div className="font-medium">{telemetry.ch.id}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Status</div>
                  <div className="font-medium">
                    {telemetry.ch.online ? "Online" : "Offline"}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Signal Strength</div>
                  <div className="font-medium">{telemetry.ch.signalStrength}%</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Camera</div>
                  <div className="font-medium">
                    {telemetry.camera.online ? "Online" : "Offline"}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Security</div>
                  <div className="font-medium">{telemetry.ch.securityState}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Heartbeat</div>
                  <div className="font-medium">{telemetry.ch.lastHeartbeat}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-5">
              <div>
                <h2 className="text-lg font-semibold">Panel Device</h2>
                <p className="text-sm text-muted-foreground">
                  Slave module controlling test channels inside the panel
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-sm text-muted-foreground">PD ID</div>
                  <div className="font-medium">{telemetry.pd.id}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Label</div>
                  <div className="font-medium">{telemetry.pd.label}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Status</div>
                  <div className="font-medium">
                    {telemetry.pd.online ? "Online" : "Offline"}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Protocol</div>
                  <div className="font-medium">{telemetry.pd.protocol}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Heartbeat</div>
                  <div className="font-medium">{telemetry.pd.lastHeartbeat}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Fault</div>
                  <div className="font-medium">{telemetry.pd.fault ?? "None"}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="space-y-4 p-5">
            <div>
              <h2 className="text-lg font-semibold">Panel Test Channels</h2>
              <p className="text-sm text-muted-foreground">
                Remote control and status for each PD output channel
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {channels.map((channel) => {
                const legacyStatus = mapChannelStateToLegacyStatus(channel)
                const isActive = legacyStatus === "active"
                const isFault = legacyStatus === "fault"

                return (
                  <Card key={channel.number} className="border">
                    <CardContent className="space-y-4 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold">
                            Channel {channel.number}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {channel.label}
                          </div>
                        </div>
                        <Badge
                          variant={
                            isFault ? "destructive" : isActive ? "default" : "secondary"
                          }
                        >
                          {isFault ? "Fault" : isActive ? "Active" : "Off"}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-muted-foreground">Phase</div>
                          <div className="font-medium">{channel.phase}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">GPIO</div>
                          <div className="font-medium">{channel.gpio}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Fault</div>
                          <div className="font-medium">{channel.fault ?? "None"}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Last Command</div>
                          <div className="font-medium">{channel.lastCommand}</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-muted-foreground">Commanded</div>
                          <div className="font-medium">{channel.commandedState}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Actual</div>
                          <div className="font-medium">{channel.actualState}</div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div>
                          <div className="text-sm font-medium">Output Control</div>
                          <div className="text-xs text-muted-foreground">
                            Send command to panel device
                          </div>
                        </div>

                        <Switch
                          checked={isActive}
                          onCheckedChange={(value) => toggleChannel(channel.number, value)}
                          disabled={status === "Offline"}
                        />
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div>
                <h2 className="text-lg font-semibold">Electrical Telemetry</h2>
                <p className="text-sm text-muted-foreground">
                  Live readings reported by the current prototype device
                </p>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Voltage RMS</div>
                  <div className="text-xl font-semibold">
                    {telemetry.measurements.voltage ?? "--"} V
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Current RMS</div>
                  <div className="text-xl font-semibold">
                    {telemetry.measurements.current ?? "--"} A
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Power</div>
                  <div className="text-xl font-semibold">
                    {telemetry.measurements.power ?? "--"} W
                  </div>
                </div>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={voltageHistory}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="voltage" stroke="currentColor" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-5">
              <div>
                <h2 className="text-lg font-semibold">Event Log</h2>
                <p className="text-sm text-muted-foreground">
                  Command history and operator actions
                </p>
              </div>

              <div className="max-h-64 space-y-2 overflow-auto">
                {eventLog.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No events logged yet.</div>
                ) : (
                  eventLog.map((entry, index) => (
                    <div
                      key={`${entry.id}-${index}`}
                      className="rounded-lg border p-3 text-sm"
                    >
                      <div className="font-medium">{entry.time}</div>
                      <div className="text-muted-foreground">
                        {entry.source} → {entry.target}
                      </div>
                      <div>
                        {entry.action} · <span className="font-medium">{entry.result}</span>
                      </div>
                      {entry.notes ? (
                        <div className="text-muted-foreground">{entry.notes}</div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div>
                <h2 className="text-lg font-semibold">Camera Feed</h2>
                <p className="text-sm text-muted-foreground">
                  Remote visual confirmation for panel and room monitoring
                </p>
              </div>

              <div className="flex h-64 items-center justify-center rounded-xl border border-dashed bg-muted/30">
                <div className="text-center text-sm text-muted-foreground">
                  {telemetry.camera.online
                    ? "Camera stream ready for integration"
                    : "Camera offline / not integrated yet"}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-5">
              <div>
                <h2 className="text-lg font-semibold">Security & Access</h2>
                <p className="text-sm text-muted-foreground">
                  Session state and command protection
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-sm text-muted-foreground">Session</div>
                  <div className="font-medium">{telemetry.ap.sessionState}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Control Lock</div>
                  <div className="font-medium">
                    {telemetry.ap.controlLocked ? "Locked" : "Unlocked"}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">User Role</div>
                  <div className="font-medium">{telemetry.ap.operatorName}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Audit Trail</div>
                  <div className="font-medium">
                    {telemetry.security.auditTrailEnabled ? "Enabled" : "Disabled"}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}
