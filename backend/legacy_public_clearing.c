#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <stdint.h>
#include <errno.h>

/*
 * legacy_public_clearing.c — modernized wire-message parser
 *
 * Defects eliminated in this rewrite:
 *
 *   OVERFLOW-001  strcpy(internal_buffer, raw_packet)
 *                 FIXED: replaced with strlcpy + explicit length guard;
 *                 the function now returns WIRE_ERR_OVERFLOW (-2) when
 *                 the raw packet exceeds the buffer capacity.
 *
 *   INJECT-001    atoll(amt_ptr) with no range check
 *                 FIXED: strtoll + errno reset + explicit positive-range
 *                 guard [1, WIRE_MAX_TRANSFER_CENTS].  Zero, negative, and
 *                 astronomically-large values are now rejected with
 *                 WIRE_ERR_INVALID_AMOUNT (-3).
 *
 *   NOCHECK-001   return 0 on overflow path
 *                 FIXED: every error path returns a distinct negative
 *                 sentinel; success is returned only when both the copy
 *                 and the validation have passed.
 *
 * Return codes:
 *   WIRE_OK               (0)   Packet parsed and validated successfully.
 *   WIRE_ERR_PARSE        (-1)  Missing amount or routing token.
 *   WIRE_ERR_OVERFLOW     (-2)  raw_packet exceeds WIRE_INTERNAL_BUF_SIZE-1.
 *   WIRE_ERR_INVALID_AMOUNT (-3) transfer_cents is zero, negative, or > cap.
 */

/* Maximum permitted single-wire transfer: $1,000,000,000.00 in cents. */
#define WIRE_MAX_TRANSFER_CENTS  INT64_C(100000000000)

/*
 * Internal working buffer.  Must be at least 2 bytes larger than the
 * longest legitimate packet so strtok can NUL-terminate safely.
 */
#define WIRE_INTERNAL_BUF_SIZE   512

/* Routing field written back to the caller. */
#define WIRE_ROUTING_SIZE        33   /* 32 chars + NUL */

#define WIRE_OK                   0
#define WIRE_ERR_PARSE           (-1)
#define WIRE_ERR_OVERFLOW        (-2)
#define WIRE_ERR_INVALID_AMOUNT  (-3)

/*
 * parse_institutional_wire_message
 *
 * Parses a wire packet of the form "<amount_cents>|<routing_code>".
 *
 * Parameters:
 *   raw_packet           NUL-terminated input string.
 *   destination_routing  Caller-allocated buffer of at least WIRE_ROUTING_SIZE
 *                        bytes; receives the routing code on success.
 *   transfer_cents       Receives the parsed amount in integer minor units.
 *
 * Returns one of the WIRE_* constants above.
 */
int parse_institutional_wire_message(const char *raw_packet,
                                     char *destination_routing,
                                     int64_t *transfer_cents)
{
    char internal_buffer[WIRE_INTERNAL_BUF_SIZE];

    /* ------------------------------------------------------------------ */
    /* FIX OVERFLOW-001: bounds-checked copy.                              */
    /* strlcpy always NUL-terminates and returns the source length.        */
    /* If the source is >= WIRE_INTERNAL_BUF_SIZE bytes the packet is too  */
    /* long to process safely — reject before any data touches the buffer. */
    /* ------------------------------------------------------------------ */
    size_t src_len = strlen(raw_packet);
    if (src_len >= WIRE_INTERNAL_BUF_SIZE) {
        return WIRE_ERR_OVERFLOW;
    }
    /* Safe: we verified src_len < sizeof(internal_buffer) above.         */
    strlcpy(internal_buffer, raw_packet, sizeof(internal_buffer));

    /* Tokenise on the first '|' separator. */
    char *amt_ptr   = strtok(internal_buffer, "|");
    char *route_ptr = strtok(NULL, "|");

    if (!amt_ptr || !route_ptr) {
        return WIRE_ERR_PARSE;
    }

    /* ------------------------------------------------------------------ */
    /* FIX INJECT-001: validated integer conversion.                       */
    /* strtoll detects overflow (ERANGE) and non-numeric input (endptr).   */
    /* ------------------------------------------------------------------ */
    errno = 0;
    char *endptr = NULL;
    long long raw_amount = strtoll(amt_ptr, &endptr, 10);

    /* Reject if: conversion failed, partial parse, errno set, or out of  */
    /* the permitted positive range.                                       */
    if (endptr == amt_ptr          /* no digits consumed           */
        || *endptr != '\0'         /* trailing non-numeric chars   */
        || errno == ERANGE         /* strtoll overflow             */
        || raw_amount <= 0         /* zero or negative             */
        || raw_amount > WIRE_MAX_TRANSFER_CENTS) {
        return WIRE_ERR_INVALID_AMOUNT;
    }

    *transfer_cents = (int64_t)raw_amount;

    /* Routing code: bounded copy, always NUL-terminated. */
    strlcpy(destination_routing, route_ptr, WIRE_ROUTING_SIZE);

    /* ------------------------------------------------------------------ */
    /* FIX NOCHECK-001: success is returned only here, after both the      */
    /* overflow guard and the amount validation have passed.               */
    /* ------------------------------------------------------------------ */
    return WIRE_OK;
}

/* -------------------------------------------------------------------------
 * Self-contained smoke-test  (compiled in when TEST_WIRE_PARSER is defined)
 * gcc -DTEST_WIRE_PARSER -std=c17 -Wall -Wextra -o wire_test legacy_public_clearing.c
 * ------------------------------------------------------------------------- */
#ifdef TEST_WIRE_PARSER
#include <assert.h>

int main(void)
{
    char routing[WIRE_ROUTING_SIZE];
    int64_t cents = 0;
    int rc;

    /* --- happy path ---------------------------------------------------- */
    rc = parse_institutional_wire_message("250099|RTNG-BANK-001",
                                          routing, &cents);
    assert(rc == WIRE_OK);
    assert(cents == 250099);
    assert(strncmp(routing, "RTNG-BANK-001", WIRE_ROUTING_SIZE) == 0);
    printf("[PASS] happy path: cents=%lld routing=%s\n",
           (long long)cents, routing);

    /* --- OVERFLOW-001: packet > WIRE_INTERNAL_BUF_SIZE-1 bytes --------- */
    char big_packet[WIRE_INTERNAL_BUF_SIZE + 16];
    memset(big_packet, 'A', sizeof(big_packet) - 1);
    big_packet[sizeof(big_packet) - 1] = '\0';
    rc = parse_institutional_wire_message(big_packet, routing, &cents);
    assert(rc == WIRE_ERR_OVERFLOW);
    printf("[PASS] OVERFLOW-001: oversized packet rejected (rc=%d)\n", rc);

    /* --- INJECT-001: negative amount ------------------------------------ */
    rc = parse_institutional_wire_message("-9999|RTNG-EVIL-001",
                                          routing, &cents);
    assert(rc == WIRE_ERR_INVALID_AMOUNT);
    printf("[PASS] INJECT-001: negative amount rejected (rc=%d)\n", rc);

    /* --- INJECT-001: zero amount ---------------------------------------- */
    rc = parse_institutional_wire_message("0|RTNG-ZERO-001",
                                          routing, &cents);
    assert(rc == WIRE_ERR_INVALID_AMOUNT);
    printf("[PASS] INJECT-001: zero amount rejected (rc=%d)\n", rc);

    /* --- INJECT-001: amount exceeds cap --------------------------------- */
    rc = parse_institutional_wire_message("999999999999999|RTNG-HUGE-001",
                                          routing, &cents);
    assert(rc == WIRE_ERR_INVALID_AMOUNT);
    printf("[PASS] INJECT-001: over-cap amount rejected (rc=%d)\n", rc);

    /* --- INJECT-001: non-numeric amount --------------------------------- */
    rc = parse_institutional_wire_message("abc|RTNG-BAD-001",
                                          routing, &cents);
    assert(rc == WIRE_ERR_INVALID_AMOUNT);
    printf("[PASS] INJECT-001: non-numeric amount rejected (rc=%d)\n", rc);

    /* --- NOCHECK-001: missing separator --------------------------------- */
    rc = parse_institutional_wire_message("250099RTNG-NOSEP",
                                          routing, &cents);
    assert(rc == WIRE_ERR_PARSE);
    printf("[PASS] NOCHECK-001: missing separator rejected (rc=%d)\n", rc);

    printf("\nAll wire-parser smoke tests passed.\n");
    return 0;
}
#endif /* TEST_WIRE_PARSER */
