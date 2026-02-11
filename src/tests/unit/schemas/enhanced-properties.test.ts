import { describe, it, expect } from 'vitest';
import { ToolSchemas } from '../../../tools/registry.js';

// Note: This file previously tested enhanced properties that were removed
// in the simplified schema to reduce token usage. The following features
// are no longer in the simplified create-event schema:
// - transparency, visibility
// - guestsCanInviteOthers, guestsCanModify, guestsCanSeeOtherGuests, anyoneCanAddSelf
// - sendUpdates
// - conferenceData
// - extendedProperties
// - attachments
// - source
// - colorId, reminders

describe('Simplified Create-Event Schema', () => {
  const createEventSchema = ToolSchemas['create-event'];

  const baseEvent = {
    calendarId: 'primary',
    summary: 'Test Event',
    start: '2025-01-20T10:00:00',
    end: '2025-01-20T11:00:00'
  };

  describe('Core Required Fields', () => {
    it('should accept minimal event with required fields only', () => {
      expect(() => createEventSchema.parse(baseEvent)).not.toThrow();
    });

    it('should reject event without calendarId', () => {
      const { calendarId, ...rest } = baseEvent;
      expect(() => createEventSchema.parse(rest)).toThrow();
    });

    it('should reject event without summary', () => {
      const { summary, ...rest } = baseEvent;
      expect(() => createEventSchema.parse(rest)).toThrow();
    });

    it('should reject event without start', () => {
      const { start, ...rest } = baseEvent;
      expect(() => createEventSchema.parse(rest)).toThrow();
    });

    it('should reject event without end', () => {
      const { end, ...rest } = baseEvent;
      expect(() => createEventSchema.parse(rest)).toThrow();
    });
  });

  describe('Simplified Attendees', () => {
    it('should accept attendees with only email', () => {
      const event = {
        ...baseEvent,
        attendees: [
          { email: 'test@example.com' }
        ]
      };
      expect(() => createEventSchema.parse(event)).not.toThrow();
    });

    it('should accept multiple attendees', () => {
      const event = {
        ...baseEvent,
        attendees: [
          { email: 'user1@example.com' },
          { email: 'user2@example.com' }
        ]
      };
      expect(() => createEventSchema.parse(event)).not.toThrow();
    });

    it('should reject attendees without email', () => {
      expect(() => createEventSchema.parse({
        ...baseEvent,
        attendees: [
          { displayName: 'No Email User' }
        ]
      })).toThrow();
    });
  });

  describe('Optional Fields', () => {
    it('should accept description', () => {
      expect(() => createEventSchema.parse({
        ...baseEvent,
        description: 'Event description'
      })).not.toThrow();
    });

    it('should accept location', () => {
      expect(() => createEventSchema.parse({
        ...baseEvent,
        location: 'Conference Room A'
      })).not.toThrow();
    });

    it('should accept timeZone', () => {
      expect(() => createEventSchema.parse({
        ...baseEvent,
        timeZone: 'America/Los_Angeles'
      })).not.toThrow();
    });

    it('should accept recurrence', () => {
      expect(() => createEventSchema.parse({
        ...baseEvent,
        recurrence: ['RRULE:FREQ=WEEKLY;COUNT=5']
      })).not.toThrow();
    });
  });

  describe('Focus Time Support', () => {
    it('should accept focusTime eventType', () => {
      expect(() => createEventSchema.parse({
        ...baseEvent,
        eventType: 'focusTime'
      })).not.toThrow();
    });

    it('should accept focusTimeProperties', () => {
      expect(() => createEventSchema.parse({
        ...baseEvent,
        eventType: 'focusTime',
        focusTimeProperties: {
          autoDeclineMode: 'declineAllConflictingInvitations',
          chatStatus: 'doNotDisturb',
          declineMessage: 'In focus time'
        }
      })).not.toThrow();
    });

    it('should reject all-day focusTime events', () => {
      expect(() => createEventSchema.parse({
        calendarId: 'primary',
        summary: 'Focus Time',
        start: '2025-01-20',  // All-day format
        end: '2025-01-21',
        eventType: 'focusTime'
      })).toThrow();
    });
  });
});
