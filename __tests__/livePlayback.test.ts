import {livePositionForDuration} from '../src/domain/tvSchedule';

describe('livePositionForDuration', () => {
  it('keeps an estimated live offset inside the real file duration', () => {
    expect(livePositionForDuration(32 * 60_000, 25 * 60_000)).toBe(7 * 60_000);
  });

  it('returns the elapsed position while it is inside the file', () => {
    expect(livePositionForDuration(10_000, 60_000)).toBe(10_000);
  });

  it('handles unavailable durations and negative offsets', () => {
    expect(livePositionForDuration(10_000, 0)).toBe(0);
    expect(livePositionForDuration(-10_000, 60_000)).toBe(0);
  });
});
