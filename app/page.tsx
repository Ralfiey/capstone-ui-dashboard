"use client"

import { defaultSystemTelemetry } from "@/lib/default-system"
import type { ChannelState, CommandState } from "@/lib/types"
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
  voltage1: number
  voltage2: number
  voltage3: number
  voltage4: number
  voltage5: number
  voltage6: number
}

type ChannelVoltageState = {
  voltage1: number | null
  voltage2: number | null
  voltage3: number | null
  voltage4: number | null
  voltage5: number | null
  voltage6: number | null
  channel1Online: boolean
  channel2Online: boolean
  channel3Online: boolean
  channel4Online: boolean
  channel5Online: boolean
  channel6Online: boolean
}

function mapChannelStateToLegacyStatus(
  channel: ChannelState
): "active" | "inactive" | "fault" {
  if (
    channel.commandedState === "fault" ||
    channel.actualState === "fault" ||
    channel.fault
  ) {
    return "fault"
  }

  if (channel.commandedState === "on" || channel.actualState === "on") {
    return "active"
  }

  return "inactive"
}

function getActiveChannelCount(channels: ChannelState[]) {
  return channels.filter(
    (channel) =>
      channel.commandedState === "on" || channel.actualState === "on"
  ).length
}

function rssiToPercent(rssi: number): string {
  if (rssi >= -50) return "100%"
  if (rssi <= -100) return "0%"
  return Math.round(((rssi + 100) / 50) * 100) + "%"
}

export default function HomePage() {
  const [esp32Ip, setEsp32Ip] = useState("")
  const [savedIp, setSavedIp] = useState("")
  const [status, setStatus] = useState<ConnectionStatus>("Offline")
  const [lastUpdate, setLastUpdate] = useState("Never")
  const [telemetry, setTelemetry] = useState(defaultSystemTelemetry)
  const [channels, setChannels] = useState(defaultSystemTelemetry.pd.channels)
  const [voltageHistory, setVoltageHistory] = useState<VoltageHistoryPoint[]>(
    []
  )
  const [channelVoltages, setChannelVoltages] = useState<ChannelVoltageState>({
    voltage1: null,
    voltage2: null,
    voltage3: null,
    voltage4: null,
    voltage5: null,
    voltage6: null,
    channel1Online: false,
    channel2Online: false,
    channel3Online: false,
    channel4Online: false,
    channel5Online: false,
    channel6Online: false,
  })
  const [eventLog, setEventLog] = useState(defaultSystemTelemetry.eventLog)

  function addLog(
    source: string,
    target: string,
    action: string,
    result: string,
    notes?: string
  ) {
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
    addLog("UI", "CH Endpoint", "Save IP", `Saved ${esp32Ip}`)
  }

  async function fetchTelemetry() {
    if (!savedIp) return

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

      const nextChannelVoltages: ChannelVoltageState = {
        voltage1:
          json.voltage1 === undefined || json.voltage1 === null
            ? null
            : Number(json.voltage1),
        voltage2:
          json.voltage2 === undefined || json.voltage2 === null
            ? null
            : Number(json.voltage2),
        voltage3:
          json.voltage3 === undefined || json.voltage3 === null
            ? null
            : Number(json.voltage3),
        voltage4:
          json.voltage4 === undefined || json.voltage4 === null
            ? null
            : Number(json.voltage4),
        voltage5:
          json.voltage5 === undefined || json.voltage5 === null
            ? null
            : Number(json.voltage5),
        voltage6:
          json.voltage6 === undefined || json.voltage6 === null
            ? null
            : Number(json.voltage6),
        channel1Online: Boolean(json.channel1 ?? json.relay1 ?? false),
        channel2Online: Boolean(json.channel2 ?? json.relay2 ?? false),
        channel3Online: Boolean(json.channel3 ?? json.relay3 ?? false),
        channel4Online: Boolean(json.channel4 ?? json.relay4 ?? false),
        channel5Online: Boolean(json.channel5 ?? json.relay5 ?? false),
        channel6Online: Boolean(json.channel6 ?? json.relay6 ?? false),
      }

      setChannelVoltages(nextChannelVoltages)

      setVoltageHistory((prev) => [
        ...prev.slice(-19),
        {
          time: now,
          voltage1: nextChannelVoltages.voltage1 ?? 0,
          voltage2: nextChannelVoltages.voltage2 ?? 0,
          voltage3: nextChannelVoltages.voltage3 ?? 0,
          voltage4: nextChannelVoltages.voltage4 ?? 0,
          voltage5: nextChannelVoltages.voltage5 ?? 0,
          voltage6: nextChannelVoltages.voltage6 ?? 0,
        },
      ])

      setTelemetry((prev) => {
        const updatedChannels: ChannelState[] = prev.pd.channels.map(
          (channel) => {
            const channelKey = `channel${channel.number}`
            const fallbackRelayKey = `relay${channel.number}`

            const reportedState = Boolean(
              json[channelKey] ??
                json[fallbackRelayKey] ??
                (channel.actualState === "on")
            )

            const actualState: CommandState = reportedState ? "on" : "off"

            const channelFault =
              typeof json[`channel${channel.number}Fault`] === "string"
                ? json[`channel${channel.number}Fault`]
                : channel.fault

            return {
              ...channel,
              actualState,
              fault: channelFault,
              lastResponse: now,
            }
          }
        )

        setChannels(updatedChannels)

        return {
          ...prev,
          ui: {
            ...prev.ui,
            online: true,
            lastHeartbeat: now,
          },
          ch: {
            ...prev.ch,
            endpoint: savedIp,
            online: true,
            signalStrength: Number(
              json.signalStrength ?? prev.ch.signalStrength ?? 0
            ),
            lastHeartbeat: now,
          },
          pd: {
            ...prev.pd,
            online: Boolean(json.pdOnline ?? true),
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
            continuityStatus:
              json.continuityStatus ?? prev.measurements.continuityStatus,
            phaseDetected: json.phaseDetected ?? prev.measurements.phaseDetected,
            neutralGroundStatus:
              json.neutralGroundStatus ?? prev.measurements.neutralGroundStatus,
            freshness: `Updated ${now}`,
          },
        }
      })

      setStatus("Connected")
      setLastUpdate(now)
    } catch (error) {
      console.log("ESP32 offline", error)
      setStatus("Offline")
      setTelemetry((prev) => ({
        ...prev,
        ui: {
          ...prev.ui,
          online: false,
        },
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
    const now = new Date().toLocaleTimeString()

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

          const nextState: CommandState = state ? "on" : "off"

          return {
            ...channel,
            commandedState: nextState,
            actualState: nextState,
            lastCommand: `${action.toUpperCase()} @ ${now}`,
            lastResponse: now,
          }
        })
      )

      addLog("UI", `PD Channel ${channelNumber}`, `Set ${action}`, "Success")
      fetchTelemetry()
    } catch (error) {
      console.log(`Failed to toggle channel ${channelNumber}`, error)
      setStatus("Offline")
      addLog("UI", `PD Channel ${channelNumber}`, `Set ${action}`, "Failed")
    }
  }

  async function allOutputsOff() {
    const now = new Date().toLocaleTimeString()
    const activeChannels = channels.filter(
      (channel) =>
        channel.commandedState === "on" || channel.actualState === "on"
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
        lastCommand: `OFF @ ${now}`,
        lastResponse: now,
      }))
    )

    addLog("UI", "All Channels", "Emergency Off", "Completed")
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

  const activeChartChannel =
    channelVoltages.channel1Online
      ? "voltage1"
      : channelVoltages.channel2Online
      ? "voltage2"
      : channelVoltages.channel3Online
      ? "voltage3"
      : channelVoltages.channel4Online
      ? "voltage4"
      : channelVoltages.channel5Online
      ? "voltage5"
      : channelVoltages.channel6Online
      ? "voltage6"
      : "voltage1"

  const activeChartLabel =
    activeChartChannel === "voltage1"
      ? "Channel 1"
      : activeChartChannel === "voltage2"
      ? "Channel 2"
      : activeChartChannel === "voltage3"
      ? "Channel 3"
      : activeChartChannel === "voltage4"
      ? "Channel 4"
      : activeChartChannel === "voltage5"
      ? "Channel 5"
      : "Channel 6"

  const activeChartValue =
    activeChartChannel === "voltage1"
      ? channelVoltages.voltage1
      : activeChartChannel === "voltage2"
      ? channelVoltages.voltage2
      : activeChartChannel === "voltage3"
      ? channelVoltages.voltage3
      : activeChartChannel === "voltage4"
      ? channelVoltages.voltage4
      : activeChartChannel === "voltage5"
      ? channelVoltages.voltage5
      : channelVoltages.voltage6

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="mx-auto max-w-7xl p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-black">
            Remote Panel Testing Dashboard
          </h1>
          <p className="text-slate-600 mt-2">
            User interface for Communication Hub and Panel Device control
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-5">
          <Card className="bg-white border-slate-200 shadow-sm">
            <CardContent className="p-4">
              <div className="text-sm text-slate-500">UI Status</div>
              <div className="mt-2">
                <Badge
                  variant="outline"
                  className="border-slate-300 text-black bg-white"
                >
                  {status}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 shadow-sm">
            <CardContent className="p-4">
              <div className="text-sm text-slate-500">CH Status</div>
              <div className="mt-2">
                <Badge
                  variant="outline"
                  className="border-slate-300 text-black bg-white"
                >
                  {telemetry.ch.online ? "Online" : "Offline"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 shadow-sm">
            <CardContent className="p-4">
              <div className="text-sm text-slate-500">PD Status</div>
              <div className="mt-2">
                <Badge
                  variant="outline"
                  className="border-slate-300 text-black bg-white"
                >
                  {telemetry.pd.online ? "Online" : "Offline"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 shadow-sm">
            <CardContent className="p-4">
              <div className="text-sm text-slate-500">Active Channels</div>
              <div className="mt-2 text-2xl font-semibold text-black">
                {activeChannelCount}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 shadow-sm">
            <CardContent className="p-4">
              <div className="text-sm text-slate-500">Last Update</div>
              <div className="mt-2 text-sm font-medium text-black">
                {lastUpdate}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-white border-slate-200 shadow-sm">
          <CardContent className="p-6 space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-black">CH Endpoint</h2>
              <p className="text-sm text-slate-600">
                Enter the current IP address used by the UI to reach the
                communication hub.
              </p>
            </div>

            <div className="flex flex-col gap-3 md:flex-row">
              <Input
                value={esp32Ip}
                onChange={(e) => setEsp32Ip(e.target.value)}
                placeholder="e.g. 192.168.0.204"
                className="bg-white border-slate-300 text-black placeholder:text-slate-400"
              />
              <Button onClick={saveDeviceIp}>Save</Button>
              <Button variant="outline" onClick={fetchTelemetry}>
                Refresh
              </Button>
              <Button variant="destructive" onClick={allOutputsOff}>
                All Outputs Off
              </Button>
            </div>

            <div className="text-sm text-slate-600">
              Connected CH: {telemetry.ch.endpoint || "None"}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="bg-white border-slate-200 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <div>
                <h2 className="text-xl font-semibold text-black">
                  Communication Hub
                </h2>
                <p className="text-sm text-slate-600">
                  Wireless bridge between the UI and the panel device
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="text-sm text-slate-500">Status</div>
                  <div className="mt-2 text-lg font-medium text-black">
                    {telemetry.ch.online ? "Online" : "Offline"}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="text-sm text-slate-500">Signal Strength</div>
                  <div className="mt-2 text-lg font-medium text-black">
                    {telemetry.ch.online
                      ? rssiToPercent(telemetry.ch.signalStrength)
                      : "0%"}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <div>
                <h2 className="text-xl font-semibold text-black">
                  Panel Device
                </h2>
                <p className="text-sm text-slate-600">
                  Slave module controlling test channels inside the panel
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="text-sm text-slate-500">Status</div>
                  <div className="mt-2 text-lg font-medium text-black">
                    {telemetry.pd.online ? "Online" : "Offline"}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="text-sm text-slate-500">Protocol</div>
                  <div className="mt-2 text-lg font-medium text-black">
                    {telemetry.pd.protocol}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-white border-slate-200 shadow-sm">
          <CardContent className="p-6 space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-black">
                Panel Test Channels
              </h2>
              <p className="text-sm text-slate-600">
                Remote control and status for each PD output channel
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {channels.map((channel) => {
                const legacyStatus = mapChannelStateToLegacyStatus(channel)
                const isActive = legacyStatus === "active"
                const isFault = legacyStatus === "fault"

                return (
                  <div
                    key={channel.number}
                    className="rounded-xl border border-slate-200 p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold text-black">
                          Channel {channel.number}
                        </div>
                        <div className="text-sm text-slate-600">
                          {channel.label}
                        </div>
                      </div>

                      <Badge
                        variant="outline"
                        className="border-slate-300 text-black bg-white"
                      >
                        {isFault ? "Fault" : isActive ? "Active" : "Off"}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-slate-500">Phase</div>
                        <div className="font-medium text-black">
                          {channel.phase}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">GPIO</div>
                        <div className="font-medium text-black">
                          {channel.gpio}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Commanded</div>
                        <div className="font-medium text-black">
                          {channel.commandedState}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Actual</div>
                        <div className="font-medium text-black">
                          {channel.actualState}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                      <div>
                        <div className="text-sm font-medium text-black">
                          Output
                        </div>
                        <div className="text-xs text-slate-500">
                          Send command to panel device
                        </div>
                      </div>
                      <Switch
                        checked={
                          channel.commandedState === "on" ||
                          channel.actualState === "on"
                        }
                        onCheckedChange={(checked) =>
                          toggleChannel(channel.number, checked)
                        }
                        disabled={status === "Offline"}
                      />
                    </div>

                    <div className="text-xs text-slate-500 space-y-1">
                      <div>Last command: {channel.lastCommand}</div>
                      <div>Last response: {channel.lastResponse}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm">
          <CardContent className="p-6 space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-black">
                Electrical Telemetry
              </h2>
              <p className="text-sm text-slate-600">
                Live channel voltage readings with automatic waveform switching
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium text-black">
                    All Channel Voltages
                  </h3>
                  <span className="text-xs text-slate-500">
                    Updates every 2 seconds
                  </span>
                </div>

                <div className="space-y-2">
                  {[1, 2, 3, 4, 5, 6].map((ch) => {
                    const voltage =
                      ch === 1
                        ? channelVoltages.voltage1
                        : ch === 2
                        ? channelVoltages.voltage2
                        : ch === 3
                        ? channelVoltages.voltage3
                        : ch === 4
                        ? channelVoltages.voltage4
                        : ch === 5
                        ? channelVoltages.voltage5
                        : channelVoltages.voltage6

                    const isOnline =
                      ch === 1
                        ? channelVoltages.channel1Online
                        : ch === 2
                        ? channelVoltages.channel2Online
                        : ch === 3
                        ? channelVoltages.channel3Online
                        : ch === 4
                        ? channelVoltages.channel4Online
                        : ch === 5
                        ? channelVoltages.channel5Online
                        : channelVoltages.channel6Online

                    return (
                      <div
                        key={ch}
                        className="grid grid-cols-3 items-center rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      >
                        <div className="font-medium text-black">
                          Channel {ch}
                        </div>
                        <div className="text-black">
                          {voltage === null ? "No data" : `${voltage.toFixed(3)} V`}
                        </div>
                        <div className="flex justify-end">
                          <Badge
                            variant="outline"
                            className="border-slate-300 text-black bg-white"
                          >
                            {isOnline ? "ON" : "OFF"}
                          </Badge>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-4 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-medium text-black">
                      Live Waveform
                    </h3>
                    <p className="text-sm text-slate-600">
                      Auto-switches to the currently active channel
                    </p>
                  </div>

                  <div className="text-right">
                    <div className="text-sm text-slate-500">
                      Displayed Channel
                    </div>
                    <div className="text-base font-semibold text-black">
                      {activeChartLabel}
                    </div>
                    <div className="text-sm text-slate-600">
                      {activeChartValue === null
                        ? "No data"
                        : `${activeChartValue.toFixed(3)} V`}
                    </div>
                  </div>
                </div>

                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={voltageHistory}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="time" />
                      <YAxis
                        domain={["auto", "auto"]}
                        tickFormatter={(value) => `${Number(value).toFixed(1)} V`}
                      />
                      <Tooltip
                        formatter={(value) => {
                          const numericValue = Array.isArray(value)
                            ? Number(value[0] ?? 0)
                            : Number(value ?? 0)
                          return [`${numericValue.toFixed(3)} V`, activeChartLabel]
                        }}
                        contentStyle={{
                          backgroundColor: "#ffffff",
                          border: "1px solid #cbd5e1",
                          color: "#000000",
                        }}
                        labelStyle={{ color: "#000000" }}
                      />
                      <Line
                        type="monotone"
                        dataKey={activeChartChannel}
                        dot={false}
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm">
          <CardContent className="p-6 space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-black">Event Log</h2>
              <p className="text-sm text-slate-600">
                Recent UI actions and system updates
              </p>
            </div>

            <div className="space-y-3">
              {eventLog.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-xl border border-slate-200 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium text-black">
                        {entry.action}
                      </div>
                      <div className="text-sm text-slate-600">
                        {entry.source} → {entry.target}
                      </div>
                    </div>
                    <div className="text-sm text-slate-500">{entry.time}</div>
                  </div>

                  <div className="mt-2 text-sm text-black">{entry.result}</div>

                  {entry.notes ? (
                    <div className="mt-1 text-sm text-slate-600">
                      {entry.notes}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
