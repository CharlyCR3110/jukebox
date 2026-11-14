/*
 * Earth Jukebox controller: ESP32 reference firmware (spec §8, P1).
 * STATUS: reference sketch. Not yet compiled or tested on hardware; the
 * hardware lead owns pins and enclosure. The browser side (apps/web/src/input/serial.ts)
 * is tested against this protocol.
 *
 * Protocol: USB serial, 115200 baud, one JSON object per line ("\n"):
 *   {"type":"NEXT_FRAME"}  {"type":"PREV_FRAME"}   rotary clockwise / counter-clockwise
 *   {"type":"ADJUST_LOCATION","direction":1}      rotary push
 *   {"type":"TOGGLE_PLAY"}                        play/pause button
 *   {"type":"HELLO","fw":"1.0"}                   on boot (ignored by the app; for humans)
 *
 * Wiring (change to match your board):
 *   Encoder A → GPIO 32, B → GPIO 33, SW → GPIO 25   (to GND, internal pull-ups)
 *   Play button → GPIO 26 (to GND)                    Status LED → GPIO 2 (on-board on many boards)
 */
#include <Arduino.h>

constexpr int PIN_ENC_A = 32;
constexpr int PIN_ENC_B = 33;
constexpr int PIN_ENC_SW = 25;
constexpr int PIN_PLAY = 26;
constexpr int PIN_LED = 2;

constexpr uint32_t DEBOUNCE_MS = 30;
constexpr uint32_t MIN_STEP_GAP_MS = 40;  // ≤ 25 frame steps/s; the browser also rate-limits

// Quadrature decoding via a state table: robust against contact bounce.
static const int8_t QDEC[16] = {0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0};
volatile int8_t encAccum = 0;
volatile uint8_t encState = 0;

void IRAM_ATTR onEncoder() {
  encState = ((encState << 2) | (digitalRead(PIN_ENC_A) << 1) | digitalRead(PIN_ENC_B)) & 0x0F;
  encAccum += QDEC[encState];
}

struct Button {
  int pin;
  bool stable = HIGH, last = HIGH;
  uint32_t changedAt = 0;
  // Returns true once per press (HIGH → LOW after DEBOUNCE_MS of stability).
  bool pressed() {
    bool now = digitalRead(pin);
    if (now != last) { last = now; changedAt = millis(); }
    if (millis() - changedAt > DEBOUNCE_MS && now != stable) {
      stable = now;
      return stable == LOW;
    }
    return false;
  }
};

Button encButton{PIN_ENC_SW};
Button playButton{PIN_PLAY};
uint32_t lastStepAt = 0;

void send(const char *json) {
  Serial.print(json);
  Serial.print('\n');
  digitalWrite(PIN_LED, LOW);   // brief blink on every event
  delay(2);
  digitalWrite(PIN_LED, HIGH);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_ENC_A, INPUT_PULLUP);
  pinMode(PIN_ENC_B, INPUT_PULLUP);
  pinMode(PIN_ENC_SW, INPUT_PULLUP);
  pinMode(PIN_PLAY, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, HIGH);  // ready
  attachInterrupt(digitalPinToInterrupt(PIN_ENC_A), onEncoder, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_ENC_B), onEncoder, CHANGE);
  delay(200);
  Serial.print("{\"type\":\"HELLO\",\"fw\":\"1.0\"}\n");
}

void loop() {
  // Most encoders produce 4 transitions per detent.
  noInterrupts();
  int8_t acc = encAccum;
  int steps = acc / 4;
  encAccum = acc - steps * 4;
  interrupts();

  if (steps != 0 && millis() - lastStepAt >= MIN_STEP_GAP_MS) {
    lastStepAt = millis();
    send(steps > 0 ? "{\"type\":\"NEXT_FRAME\"}" : "{\"type\":\"PREV_FRAME\"}");
  }
  if (encButton.pressed()) send("{\"type\":\"ADJUST_LOCATION\",\"direction\":1}");
  if (playButton.pressed()) send("{\"type\":\"TOGGLE_PLAY\"}");
  delay(1);
}
