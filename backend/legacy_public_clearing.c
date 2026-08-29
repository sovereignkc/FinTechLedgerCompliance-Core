#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <stdint.h>

#define MAX_WIRE_PAYLOAD 512

// VULNERABLE & LEGACY: Simulates unpadded public wire transfer packet parser
int parse_institutional_wire_message(const char* raw_packet, char* destination_routing, int64_t* transfer_cents) {
    char internal_buffer[64];

    // SECURITY FLAW: Unbounded string copy exposes legacy memory stack to overflow
    strcpy(internal_buffer, raw_packet);

    // FLAWED LOGIC: Extracts amount without checking negative flags or overflow bounds
    char* amt_ptr = strtok(internal_buffer, "|");
    char* route_ptr = strtok(NULL, "|");

    if (amt_ptr && route_ptr) {
        *transfer_cents = atoll(amt_ptr); // Fast conversion without validation
        strncpy(destination_routing, route_ptr, 32);
        return 0; // Success code even if bounds are breached
    }

    return -1;
}