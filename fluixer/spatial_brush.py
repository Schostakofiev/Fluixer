"""Direct path painting uses normalized arc-length intervals, without projection."""
import math


def validate_windows(windows):
    if not isinstance(windows,list) or len(windows)>10000:
        raise ValueError('Invalid spatial brush intervals')
    result=[]
    for item in windows:
        if not isinstance(item,list) or len(item)!=2 or any(isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) for x in item):
            raise ValueError('Invalid spatial brush intervals')
        a,b=item
        if not 0<=a<b<=1 or (result and a<result[-1][1]):
            raise ValueError('Spatial brush intervals must be ordered and non-overlapping')
        result.append((a,b))
    return tuple(result)


MIN_SEGMENT_LENGTH_MM = 1.0


def merge_short_segments(sequence, minimum_length=MIN_SEGMENT_LENGTH_MM):
    """Merge short spatial-brush intervals without changing the path extent.

    Input is the alternating, contiguous output of partition_path. Process the
    shortest interval first (ties in path order). An interior interval adopts
    its neighbours' phase and joins them; an endpoint joins its sole neighbour.
    A whole path shorter than the threshold has no neighbour and stays intact.
    """
    import heapq
    from .segments import PhysicalSegment, PhysicalSequence

    if sequence.length_unit != 'mm':
        raise ValueError('Spatial brush minimum segment length requires mm')
    if not math.isfinite(minimum_length) or minimum_length <= 0:
        raise ValueError('Minimum segment length must be positive and finite')
    items = list(sequence.segments)
    if len(items) < 2:
        return sequence
    previous = [i - 1 for i in range(len(items))]
    following = [i + 1 for i in range(len(items))]
    following[-1] = -1
    versions = [0] * len(items)
    queue = []

    def enqueue(i):
        item = items[i]
        # Normalized brush coordinates can introduce sub-nanometre roundoff
        # when converted back to physical distance; retain exact 1 mm marks.
        if item is not None and item.length < minimum_length - 1e-9:
            heapq.heappush(queue, (item.length, i, versions[i]))

    for i in range(len(items)):
        enqueue(i)
    while queue:
        _, i, version = heapq.heappop(queue)
        if items[i] is None or versions[i] != version:
            continue
        left, right = previous[i], following[i]
        if left == -1 and right == -1:
            break
        if left != -1:
            target = left
            end = items[right].end_distance if right != -1 else items[i].end_distance
            next_index = following[right] if right != -1 else -1
            items[left] = PhysicalSegment(items[left].phase, items[left].start_distance, end)
            following[left] = next_index
            if next_index != -1:
                previous[next_index] = left
            if right != -1:
                items[right] = None
        else:
            target = right
            items[right] = PhysicalSegment(items[right].phase, items[i].start_distance, items[right].end_distance)
            previous[right] = -1
        items[i] = None
        versions[target] += 1
        enqueue(target)
    return PhysicalSequence(sequence.length_unit, tuple(item for item in items if item is not None))
