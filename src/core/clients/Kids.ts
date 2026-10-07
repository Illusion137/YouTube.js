import { Parser } from '../../parser/index.js';
import { Channel, HomeFeed, Search, VideoInfo } from '../../parser/ytkids/index.js';
import NavigationEndpoint from '../../parser/classes/NavigationEndpoint.js';
import KidsBlocklistPickerItem from '../../parser/classes/ytkids/KidsBlocklistPickerItem.js';
import { InnertubeError, generateRandomString } from '../../utils/Utils.js';
import type { Session, ApiResponse, Context, PartialContext } from '../index.js';
import type { GetVideoInfoOptions } from '../../types/index.js';

type KidsAppInfo = Context['client']['kidsAppInfo'];
const DEFAULT_KIDS_APP_INFO: KidsAppInfo = {
  categorySettings: {
    enabledCategories: [
      'approved_for_you', 'black_joy', 'camp', 'collections', 'earth', 'explore',
      'favorites', 'gaming', 'halloween', 'hero', 'learning', 'move', 'music',
      'reading', 'shared_by_parents', 'shows', 'soccer', 'sports', 'spotlight', 'winter'
    ]
  },
  contentSettings: {
    corpusPreference: 'KIDS_CORPUS_PREFERENCE_YOUNGER',
    kidsNoSearchMode: 'YT_KIDS_NO_SEARCH_MODE_OFF'
  }
} as const;

export default class Kids {
  #session: Session;

  constructor(session: Session) {
    this.#session = session;
  }

  #oneTimeContext(kids_app_info: KidsAppInfo): PartialContext {
    return { client: { kidsAppInfo: kids_app_info } };
  }

  async search(query: string, kids_app_info: KidsAppInfo = DEFAULT_KIDS_APP_INFO): Promise<Search> {
    const search_endpoint = new NavigationEndpoint({ searchEndpoint: { query } });
    const response = await search_endpoint.call(this.#session.actions, { client: 'YTKIDS', one_time_context: this.#oneTimeContext(kids_app_info) });
    return new Search(this.#session.actions, response);
  }

  async getInfo(video_id: string, options?: Omit<GetVideoInfoOptions, 'client'>, kids_app_info: KidsAppInfo = DEFAULT_KIDS_APP_INFO): Promise<VideoInfo> {
    const payload = { videoId: video_id };
    const watch_endpoint = new NavigationEndpoint({ watchEndpoint: payload });
    const watch_next_endpoint = new NavigationEndpoint({ watchNextEndpoint: payload });

    const session = this.#session;

    const extra_payload: Record<string, any> = {
      playbackContext: {
        contentPlaybackContext: {
          vis: 0,
          splay: false,
          lactMilliseconds: '-1',
          signatureTimestamp: session.player?.signature_timestamp
        }
      },
      client: 'YTKIDS',
      one_time_context: this.#oneTimeContext(kids_app_info)
    };

    if (options?.po_token) {
      extra_payload.serviceIntegrityDimensions = {
        poToken: options.po_token
      };
    } else if (session.po_token) {
      extra_payload.serviceIntegrityDimensions = {
        poToken: session.po_token
      };
    }
    
    const watch_response = watch_endpoint.call(session.actions, extra_payload);

    const watch_next_response = watch_next_endpoint.call(session.actions, { client: 'YTKIDS', one_time_context: this.#oneTimeContext(kids_app_info) });

    const response = await Promise.all([ watch_response, watch_next_response ]);
    const cpn = generateRandomString(16);

    return new VideoInfo(response, session.actions, cpn);
  }

  async getChannel(channel_id: string, kids_app_info: KidsAppInfo = DEFAULT_KIDS_APP_INFO): Promise<Channel> {
    const context: PartialContext = { client: { kidsAppInfo: kids_app_info } };
    const browse_endpoint = new NavigationEndpoint({ browseEndpoint: { browseId: channel_id } });
    const response = await browse_endpoint.call(this.#session.actions, { client: 'YTKIDS', one_time_context: this.#oneTimeContext(kids_app_info) });
    return new Channel(this.#session.actions, response);
  }

  async getHomeFeed(kids_app_info: KidsAppInfo = DEFAULT_KIDS_APP_INFO): Promise<HomeFeed> {
    const browse_endpoint = new NavigationEndpoint({ browseEndpoint: { browseId: 'FEkids_home' } });
    const response = await browse_endpoint.call(this.#session.actions, { client: 'YTKIDS', one_time_context: this.#oneTimeContext(kids_app_info) });
    return new HomeFeed(this.#session.actions, response);
  }

  /**
   * Retrieves the list of supervised accounts that the signed-in user has
   * access to, and blocks the given channel for each of them.
   * @param channel_id - The channel id to block.
   * @param kids_app_info - The KidsAppInfo context
   * @returns A list of API responses.
   */
  async blockChannel(channel_id: string, kids_app_info: KidsAppInfo = DEFAULT_KIDS_APP_INFO): Promise<ApiResponse[]> {
    const session = this.#session;

    if (!session.logged_in)
      throw new InnertubeError('You must be signed in to perform this operation.');

    const kids_blocklist_picker_command = new NavigationEndpoint({
      getKidsBlocklistPickerCommand: {
        blockedForKidsContent: {
          external_channel_id: channel_id
        }
      }
    });

    const response = await kids_blocklist_picker_command.call(session.actions, { client: 'YTKIDS', one_time_context: this.#oneTimeContext(kids_app_info) });
    const popup = response.data.command.confirmDialogEndpoint;
    const popup_fragment = { contents: popup.content, engagementPanels: [] };
    const kid_picker = Parser.parseResponse(popup_fragment);
    const kids = kid_picker.contents_memo?.getType(KidsBlocklistPickerItem);

    if (!kids)
      throw new InnertubeError('Could not find any kids profiles or supervised accounts.');

    // Iterate through the kids and block the channel if not already blocked.
    const responses: ApiResponse[] = [];

    for (const kid of kids) {
      if (!kid.block_button?.is_toggled) {
        kid.setActions(session.actions);
        // Block channel and add to the response list.
        responses.push(await kid.blockChannel());
      }
    }

    return responses;
  }
}