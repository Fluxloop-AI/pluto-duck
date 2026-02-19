// Forked from @lexical/react@0.18.0 LexicalDraggableBlockPlugin.dev.mjs.

export interface PointLike {
  x: number;
  y: number;
}

export interface RectangleLike {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

interface PointContainReason {
  isOnBottomSide: boolean;
  isOnLeftSide: boolean;
  isOnRightSide: boolean;
  isOnTopSide: boolean;
}

export interface PointContainResult {
  reason: PointContainReason;
  result: boolean;
}

export class Point implements PointLike {
  private _x: number;
  private _y: number;

  constructor(x: number, y: number) {
    this._x = x;
    this._y = y;
  }

  get x(): number {
    return this._x;
  }

  get y(): number {
    return this._y;
  }

  equals({ x, y }: PointLike): boolean {
    return this.x === x && this.y === y;
  }

  calcDeltaXTo({ x }: PointLike): number {
    return this.x - x;
  }

  calcDeltaYTo({ y }: PointLike): number {
    return this.y - y;
  }

  calcHorizontalDistanceTo(point: PointLike): number {
    return Math.abs(this.calcDeltaXTo(point));
  }

  calcVerticalDistance(point: PointLike): number {
    return Math.abs(this.calcDeltaYTo(point));
  }

  calcDistanceTo(point: PointLike): number {
    return Math.sqrt(Math.pow(this.calcDeltaXTo(point), 2) + Math.pow(this.calcDeltaYTo(point), 2));
  }
}

export function isPoint(value: unknown): value is Point {
  return value instanceof Point;
}

export class Rectangle {
  private _top: number;
  private _right: number;
  private _left: number;
  private _bottom: number;

  constructor(left: number, top: number, right: number, bottom: number) {
    const [physicTop, physicBottom] = top <= bottom ? [top, bottom] : [bottom, top];
    const [physicLeft, physicRight] = left <= right ? [left, right] : [right, left];

    this._top = physicTop;
    this._right = physicRight;
    this._left = physicLeft;
    this._bottom = physicBottom;
  }

  get top(): number {
    return this._top;
  }

  get right(): number {
    return this._right;
  }

  get bottom(): number {
    return this._bottom;
  }

  get left(): number {
    return this._left;
  }

  get width(): number {
    return Math.abs(this._left - this._right);
  }

  get height(): number {
    return Math.abs(this._bottom - this._top);
  }

  equals({ top, left, bottom, right }: RectangleLike): boolean {
    return top === this._top && bottom === this._bottom && left === this._left && right === this._right;
  }

  contains(target: Point): PointContainResult;
  contains(target: Rectangle): boolean;
  contains(target: Point | Rectangle): PointContainResult | boolean {
    if (isPoint(target)) {
      const { x, y } = target;
      const isOnTopSide = y < this._top;
      const isOnBottomSide = y > this._bottom;
      const isOnLeftSide = x < this._left;
      const isOnRightSide = x > this._right;
      const result = !isOnTopSide && !isOnBottomSide && !isOnLeftSide && !isOnRightSide;

      return {
        reason: {
          isOnBottomSide,
          isOnLeftSide,
          isOnRightSide,
          isOnTopSide,
        },
        result,
      };
    }

    const { top, left, bottom, right } = target;

    return (
      top >= this._top &&
      top <= this._bottom &&
      bottom >= this._top &&
      bottom <= this._bottom &&
      left >= this._left &&
      left <= this._right &&
      right >= this._left &&
      right <= this._right
    );
  }

  intersectsWith(rect: Rectangle): boolean {
    const { left: x1, top: y1, width: w1, height: h1 } = rect;
    const { left: x2, top: y2, width: w2, height: h2 } = this;
    const maxX = x1 + w1 >= x2 + w2 ? x1 + w1 : x2 + w2;
    const maxY = y1 + h1 >= y2 + h2 ? y1 + h1 : y2 + h2;
    const minX = x1 <= x2 ? x1 : x2;
    const minY = y1 <= y2 ? y1 : y2;

    return maxX - minX <= w1 + w2 && maxY - minY <= h1 + h2;
  }

  generateNewRect({
    left = this.left,
    top = this.top,
    right = this.right,
    bottom = this.bottom,
  }: {
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
  }): Rectangle {
    return new Rectangle(left, top, right, bottom);
  }

  static fromLTRB(left: number, top: number, right: number, bottom: number): Rectangle {
    return new Rectangle(left, top, right, bottom);
  }

  static fromLWTH(left: number, width: number, top: number, height: number): Rectangle {
    return new Rectangle(left, top, left + width, top + height);
  }

  static fromPoints(startPoint: PointLike, endPoint: PointLike): Rectangle {
    const { y: top, x: left } = startPoint;
    const { y: bottom, x: right } = endPoint;

    return Rectangle.fromLTRB(left, top, right, bottom);
  }

  static fromDOM(dom: HTMLElement): Rectangle {
    const { top, width, left, height } = dom.getBoundingClientRect();

    return Rectangle.fromLWTH(left, width, top, height);
  }
}
