// Pre-roll ad configuration.
//
// AD_TAG_URL must point to a VAST-compliant ad tag. This works with:
//   - Google AdSense for Video / Google Ad Manager
//   - Adsterra (Video Ads product)
//   - ExoClick (In-Stream Video)
//   - PropellerAds (Video/CTV product)
//   - Most other ad networks that offer "VAST tag" or "in-stream video" ads
//
// Right now this points to Google's public IMA sample tag, which always
// serves a real test ad — useful for confirming the player works, but it
// pays nothing. Replace AD_TAG_URL with the tag your ad network gives you
// after sign-up and approval, and that's the only change needed here.

window.PAK_ANIME_ADS = {
  AD_TAG_URL:
    'https://pubads.g.doubleclick.net/gampad/ads?iu=/21775744923/external/single_ad_samples&sz=640x480&cust_params=sample_ct%3Dlinear&ciu_szs=300x250%2C728x90&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=',
  ENABLED: true,
};
