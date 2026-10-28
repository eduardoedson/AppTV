import {describePlaybackError, shouldUseSoftwareDecoder} from '../src/catalog/sourceResolver';

describe('describePlaybackError', () => {
  it('ignores line numbers from the stack trace', () => {
    const error = {
      errorString: 'ExoPlaybackException: Source error',
      errorException: 'androidx.media3.exoplayer.ExoPlaybackException: Source error',
      errorCode: '4005',
      errorStackTrace: 'at androidx.media3.exoplayer.ExoPlayerImplInternal.handleMessage(ExoPlayerImplInternal.java:545)',
    };
    expect(describePlaybackError(error, true)).toBe('Codec de vídeo ou áudio não suportado pela TV. (código 4005)');
  });

  it('reads the HTTP status from the response code', () => {
    const error = {
      errorString: 'Source error',
      errorException: 'InvalidResponseCodeException: Response code: 403',
      errorCode: '2004',
    };
    expect(describePlaybackError(error, true)).toContain('HTTP 403');
  });

  it('keeps the player code for unknown errors', () => {
    expect(describePlaybackError({errorString: 'Something failed', errorCode: '1000'}, false)).toBe(
      'Something failed (código 1000)',
    );
  });

  it('removes the react-native-video prefix from Media3 error codes', () => {
    expect(
      describePlaybackError(
        {
          errorString: 'ExoPlaybackException: ERROR_CODE_DECODING_FAILED',
          errorCode: '24003',
        },
        true,
      ),
    ).toBe('Falha ao decodificar o vídeo. (código 4003)');
  });

  it('selects the software fallback for decoder failures', () => {
    expect(shouldUseSoftwareDecoder({errorCode: '24003'})).toBe(true);
    expect(shouldUseSoftwareDecoder({errorCode: '22002'})).toBe(false);
  });
});
